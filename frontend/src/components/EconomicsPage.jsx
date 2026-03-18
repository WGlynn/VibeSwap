import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

// ============ Economics Page ============
// Comprehensive education page for VibeSwap's "Cooperative Capitalism" model.
// Sections: Two Forces, Fee Flow, Treasury, Cooperative/Competitive mechanisms,
// Economic Simulation, and Key Papers.

const PHI = 1.618033988749895

// Seeded PRNG — deterministic across renders
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
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
      <span className="text-[10px] font-mono text-amber-400/70 uppercase tracking-wider">{tag}</span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

// ============ Two Forces Balance SVG ============
function TwoForcesSection() {
  const cooperative = [
    { label: 'Insurance Pools', desc: 'Mutualized IL protection' },
    { label: 'Treasury Stabilization', desc: 'Counter-cyclical reserves' },
    { label: 'Shapley Distribution', desc: 'Fair reward allocation' },
  ]
  const competitive = [
    { label: 'Priority Auctions', desc: 'Pay for execution order' },
    { label: 'Arbitrage', desc: 'Cross-chain price alignment' },
    { label: 'Market Making', desc: 'LP competition for fees' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 1 / PHI, ease: 'easeOut' }}
    >
      <GlassCard glowColor="warning" className="p-5">
        {/* Balance SVG */}
        <div className="flex justify-center mb-5">
          <svg width="220" height="120" viewBox="0 0 220 120" className="opacity-90">
            {/* Fulcrum triangle */}
            <polygon points="110,100 95,118 125,118" fill="none" stroke="rgba(245,158,11,0.5)" strokeWidth="1.5" />
            {/* Beam */}
            <line x1="20" y1="52" x2="200" y2="52" stroke="rgba(245,158,11,0.4)" strokeWidth="2" />
            {/* Fulcrum line */}
            <line x1="110" y1="52" x2="110" y2="100" stroke="rgba(245,158,11,0.4)" strokeWidth="1.5" />
            {/* Left pan (cooperative) */}
            <path d="M 20,52 Q 20,70 55,70 L 55,70 Q 20,70 20,52" fill="none" stroke="rgba(34,197,94,0.4)" strokeWidth="1" />
            <rect x="15" y="52" width="80" height="2" rx="1" fill="rgba(34,197,94,0.25)" />
            <circle cx="55" cy="40" r="16" fill="none" stroke="rgba(34,197,94,0.3)" strokeWidth="1" strokeDasharray="3,3" />
            <text x="55" y="44" textAnchor="middle" fill="rgba(34,197,94,0.8)" fontSize="10" fontFamily="monospace">CO</text>
            {/* Right pan (competitive) */}
            <rect x="125" y="52" width="80" height="2" rx="1" fill="rgba(59,130,246,0.25)" />
            <circle cx="165" cy="40" r="16" fill="none" stroke="rgba(59,130,246,0.3)" strokeWidth="1" strokeDasharray="3,3" />
            <text x="165" y="44" textAnchor="middle" fill="rgba(59,130,246,0.8)" fontSize="10" fontFamily="monospace">CM</text>
            {/* Center equilibrium marker */}
            <circle cx="110" cy="52" r="4" fill="rgba(245,158,11,0.6)" />
            <text x="110" y="26" textAnchor="middle" fill="rgba(245,158,11,0.6)" fontSize="8" fontFamily="monospace">EQUILIBRIUM</text>
          </svg>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Cooperative column */}
          <div>
            <div className="text-[10px] font-mono text-green-400/70 uppercase tracking-wider mb-2">
              Cooperative Forces
            </div>
            <div className="space-y-2">
              {cooperative.map((item) => (
                <div key={item.label} className="bg-black/30 rounded-lg p-2.5 border border-green-500/15">
                  <p className="text-xs font-mono text-green-400 font-bold">{item.label}</p>
                  <p className="text-[10px] font-mono text-black-400 mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
          {/* Competitive column */}
          <div>
            <div className="text-[10px] font-mono text-blue-400/70 uppercase tracking-wider mb-2">
              Competitive Forces
            </div>
            <div className="space-y-2">
              {competitive.map((item) => (
                <div key={item.label} className="bg-black/30 rounded-lg p-2.5 border border-blue-500/15">
                  <p className="text-xs font-mono text-blue-400 font-bold">{item.label}</p>
                  <p className="text-[10px] font-mono text-black-400 mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 bg-black/30 rounded-lg p-3 border border-amber-500/20">
          <p className="text-xs font-mono text-amber-400/80 text-center">
            Neither force dominates. The system finds equilibrium through mechanism design —
            self-interest and mutual aid reinforce each other by construction.
          </p>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Fee Flow Sankey Diagram ============
function FeeFlowSection() {
  const [hoveredPath, setHoveredPath] = useState(null)

  // LP base fees: 100% to LPs (protocolFeeShare = 0)
  // Non-swap revenue (priority bids) handled by FeeRouter:
  //   40% treasury, 20% insurance, 30% revshare, 10% buyback
  const paths = [
    { id: 'lp', label: 'LP Rewards', pct: 100, color: '#22c55e', y: 25 },
    { id: 'treasury', label: 'Treasury (priority bids)', pct: 40, color: '#f59e0b', y: 55 },
    { id: 'burn', label: 'Buyback & Burn (priority bids)', pct: 10, color: '#ef4444', y: 82 },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 1 / PHI, ease: 'easeOut' }}
    >
      <GlassCard glowColor="warning" className="p-5">
        <div className="flex justify-center">
          <svg width="360" height="110" viewBox="0 0 360 110" className="w-full max-w-[360px]">
            {/* Source node */}
            <rect x="5" y="20" width="70" height="70" rx="8" fill="rgba(245,158,11,0.12)" stroke="rgba(245,158,11,0.35)" strokeWidth="1" />
            <text x="40" y="50" textAnchor="middle" fill="rgba(245,158,11,0.9)" fontSize="9" fontFamily="monospace">0.05%</text>
            <text x="40" y="62" textAnchor="middle" fill="rgba(245,158,11,0.6)" fontSize="7" fontFamily="monospace">LP FEE</text>

            {/* Flow paths */}
            {paths.map((p) => {
              const active = hoveredPath === p.id || hoveredPath === null
              const opacity = active ? 1 : 0.2
              const strokeW = hoveredPath === p.id ? 3 : 2
              return (
                <g key={p.id}
                  onMouseEnter={() => setHoveredPath(p.id)}
                  onMouseLeave={() => setHoveredPath(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Curved path */}
                  <path
                    d={`M 75,55 C 140,55 160,${p.y} 230,${p.y}`}
                    fill="none"
                    stroke={p.color}
                    strokeWidth={strokeW}
                    strokeOpacity={opacity * 0.6}
                    strokeLinecap="round"
                  />
                  {/* Arrow head */}
                  <circle cx="230" cy={p.y} r="3" fill={p.color} fillOpacity={opacity * 0.8} />
                  {/* Target label */}
                  <rect x="240" y={p.y - 14} width="110" height="28" rx="6"
                    fill={`${p.color}11`}
                    stroke={p.color}
                    strokeWidth="1"
                    strokeOpacity={opacity * 0.4}
                  />
                  <text x="295" y={p.y - 1} textAnchor="middle" fill={p.color} fillOpacity={opacity} fontSize="8" fontFamily="monospace" fontWeight="bold">
                    {p.label}
                  </text>
                  <text x="295" y={p.y + 9} textAnchor="middle" fill={p.color} fillOpacity={opacity * 0.7} fontSize="8" fontFamily="monospace">
                    {p.pct}%
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
        <p className="text-[10px] font-mono text-black-500 text-center mt-3">
          Hover each path to highlight. Every swap distributes value across the ecosystem.
        </p>
      </GlassCard>
    </motion.div>
  )
}

// ============ Cooperative Mechanism Cards ============
const COOPERATIVE_MECHANISMS = [
  {
    title: 'Shapley Distribution',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(34,197,94,0.7)" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" strokeDasharray="4,3" />
        <circle cx="12" cy="12" r="3" fill="rgba(34,197,94,0.3)" />
        <line x1="12" y1="3" x2="12" y2="9" /><line x1="12" y1="15" x2="12" y2="21" />
        <line x1="3" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="21" y2="12" />
      </svg>
    ),
    desc: 'Game-theoretic fair reward allocation. Each participant receives exactly their marginal contribution to the coalition — no more, no less. Computed via on-chain Shapley value approximation.',
  },
  {
    title: 'IL Protection',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(34,197,94,0.7)" strokeWidth="1.5">
        <path d="M12 2 L4 7 L4 14 C4 18 8 22 12 22 C16 22 20 18 20 14 L20 7 Z" />
        <polyline points="9,12 11,14 15,10" stroke="rgba(34,197,94,0.9)" strokeWidth="2" />
      </svg>
    ),
    desc: 'Mutual insurance pool funded by volatility fee surplus and slashing penalties. LPs who suffer impermanent loss beyond a threshold receive compensation. Risk is shared across all participants, not borne alone.',
  },
  {
    title: 'Circuit Breakers',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(34,197,94,0.7)" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" />
        <line x1="12" y1="12" x2="15" y2="15" strokeWidth="2" />
        <path d="M4 4 L8 8" stroke="rgba(239,68,68,0.5)" strokeWidth="2" />
      </svg>
    ),
    desc: 'Collective safety valves that halt trading when anomalies are detected. Volume spikes, price deviations, or withdrawal surges trigger automatic pauses — protecting all users from cascading failures.',
  },
  {
    title: 'Oracle Network',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(34,197,94,0.7)" strokeWidth="1.5">
        <circle cx="12" cy="6" r="3" /><circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" />
        <line x1="12" y1="9" x2="5" y2="15" /><line x1="12" y1="9" x2="19" y2="15" />
        <line x1="8" y1="18" x2="16" y2="18" />
      </svg>
    ),
    desc: 'Shared truth infrastructure. Kalman-filter price oracle aggregates multiple sources into a single reliable feed. All participants benefit from the same accurate pricing — a public good funded collectively.',
  },
]

// ============ Competitive Mechanism Cards ============
const COMPETITIVE_MECHANISMS = [
  {
    title: 'Priority Bids',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(59,130,246,0.7)" strokeWidth="1.5">
        <path d="M13 2 L3 14 L10 14 L11 22 L21 10 L14 10 Z" fill="rgba(59,130,246,0.15)" />
      </svg>
    ),
    desc: 'Within each batch, traders can bid for execution priority. Unlike MEV, this is transparent and fair — the premium goes to the protocol treasury, not to anonymous front-runners.',
  },
  {
    title: 'Arbitrage',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(59,130,246,0.7)" strokeWidth="1.5">
        <polyline points="4,18 8,12 12,16 16,8 20,6" strokeWidth="2" />
        <circle cx="4" cy="18" r="2" fill="rgba(59,130,246,0.3)" />
        <circle cx="20" cy="6" r="2" fill="rgba(59,130,246,0.3)" />
      </svg>
    ),
    desc: 'Cross-chain price alignment via LayerZero. Arbitrageurs profit by equalizing prices across chains — their self-interest produces tighter spreads and more efficient markets for everyone.',
  },
  {
    title: 'Market Making',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(59,130,246,0.7)" strokeWidth="1.5">
        <rect x="3" y="14" width="4" height="7" rx="1" fill="rgba(59,130,246,0.2)" />
        <rect x="10" y="8" width="4" height="13" rx="1" fill="rgba(59,130,246,0.25)" />
        <rect x="17" y="3" width="4" height="18" rx="1" fill="rgba(59,130,246,0.3)" />
      </svg>
    ),
    desc: 'LPs compete for swap fees by providing deeper liquidity. Better pricing attracts more volume, more volume generates more fees. A virtuous cycle driven by competition, benefiting traders.',
  },
  {
    title: 'Governance',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(59,130,246,0.7)" strokeWidth="1.5">
        <path d="M12 2 L2 8 L2 10 L22 10 L22 8 Z" fill="rgba(59,130,246,0.15)" />
        <line x1="5" y1="10" x2="5" y2="18" /><line x1="9" y1="10" x2="9" y2="18" />
        <line x1="15" y1="10" x2="15" y2="18" /><line x1="19" y1="10" x2="19" y2="18" />
        <rect x="2" y="18" width="20" height="3" rx="1" fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.7)" />
      </svg>
    ),
    desc: 'Proposal markets where governance token holders compete to shape protocol parameters. Fee rates, emission schedules, and treasury allocation are decided by those with skin in the game.',
  },
]

// ============ Economic Simulation ============
function EconomicSimulation() {
  const [feeRate, setFeeRate] = useState(30)       // basis points (30 = 0.30%)
  const [burnRate, setBurnRate] = useState(10)      // percentage of fees
  const [emissionRate, setEmissionRate] = useState(50) // tokens/day in thousands
  const [lpCount, setLpCount] = useState(500)       // number of LPs

  const simData = useMemo(() => {
    const rng = seededRandom(42)
    const months = 12
    const prices = []
    const tvls = []
    const treasuries = []

    // Fee multiplier relative to default 0.30%
    const feeMul = feeRate / 30
    // Burn creates scarcity — higher burn = price tailwind
    const burnMul = 1 + (burnRate - 10) * 0.004
    // More emission = dilution pressure
    const emitMul = 1 - (emissionRate - 50) * 0.002
    // More LPs = deeper liquidity = more volume attraction
    const lpMul = 1 + (lpCount - 500) * 0.0004

    let price = 1.0
    let tvl = 10_000_000
    let treasury = 2_000_000

    for (let m = 0; m < months; m++) {
      const noise = (rng() - 0.45) * 0.12
      price *= (1 + noise) * burnMul * emitMul
      tvl *= (1 + (rng() - 0.4) * 0.08) * feeMul * lpMul
      treasury += tvl * (feeRate / 10000) * 0.20 * (30 / 365)
      treasury *= 1 + (rng() - 0.48) * 0.03

      prices.push(Math.max(0.01, price))
      tvls.push(Math.max(100_000, tvl))
      treasuries.push(Math.max(10_000, treasury))
    }

    return { prices, tvls, treasuries }
  }, [feeRate, burnRate, emissionRate, lpCount])

  const finalPrice = simData.prices[simData.prices.length - 1]
  const finalTvl = simData.tvls[simData.tvls.length - 1]
  const finalTreasury = simData.treasuries[simData.treasuries.length - 1]

  const sliders = [
    { label: 'Fee Rate', value: feeRate, set: setFeeRate, min: 5, max: 100, unit: 'bps', display: `${(feeRate / 100).toFixed(2)}%` },
    { label: 'Burn Rate', value: burnRate, set: setBurnRate, min: 0, max: 50, unit: '%', display: `${burnRate}%` },
    { label: 'Emission', value: emissionRate, set: setEmissionRate, min: 10, max: 200, unit: 'k/day', display: `${emissionRate}k/day` },
    { label: 'LP Count', value: lpCount, set: setLpCount, min: 50, max: 2000, unit: '', display: lpCount.toLocaleString() },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 1 / PHI, ease: 'easeOut' }}
    >
      <GlassCard glowColor="warning" className="p-5">
        {/* Sliders */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          {sliders.map((s) => (
            <div key={s.label}>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] font-mono text-black-500 uppercase">{s.label}</span>
                <span className="text-xs font-mono text-amber-400">{s.display}</span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                value={s.value}
                onChange={(e) => s.set(Number(e.target.value))}
                className="w-full h-1 bg-black-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          ))}
        </div>

        {/* Results with sparklines */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-black/30 rounded-lg p-3 border border-amber-500/15">
            <p className="text-[10px] font-mono text-black-500 uppercase mb-1">Token Price (12mo)</p>
            <p className="text-lg font-bold font-mono text-white">${finalPrice.toFixed(3)}</p>
            <div className="mt-1">
              <Sparkline data={simData.prices} width={80} height={20} color="#f59e0b" />
            </div>
          </div>
          <div className="bg-black/30 rounded-lg p-3 border border-amber-500/15">
            <p className="text-[10px] font-mono text-black-500 uppercase mb-1">TVL (12mo)</p>
            <p className="text-lg font-bold font-mono text-white">${(finalTvl / 1e6).toFixed(1)}M</p>
            <div className="mt-1">
              <Sparkline data={simData.tvls} width={80} height={20} color="#22c55e" />
            </div>
          </div>
          <div className="bg-black/30 rounded-lg p-3 border border-amber-500/15">
            <p className="text-[10px] font-mono text-black-500 uppercase mb-1">Treasury (12mo)</p>
            <p className="text-lg font-bold font-mono text-white">${(finalTreasury / 1e6).toFixed(1)}M</p>
            <div className="mt-1">
              <Sparkline data={simData.treasuries} width={80} height={20} color="#f59e0b" />
            </div>
          </div>
        </div>

        <p className="text-[10px] font-mono text-black-500 text-center mt-3">
          Simulation uses seeded PRNG with parameter multipliers. Not financial advice.
        </p>
      </GlassCard>
    </motion.div>
  )
}

// ============ Key Papers ============
const KEY_PAPERS = [
  {
    title: 'Economitra',
    desc: 'Foundational economic framework for decentralized exchange mechanism design.',
    tag: 'Mechanism Design',
  },
  {
    title: 'Ergon Monetary Biology',
    desc: 'How proof-of-work creates thermodynamic money — energy cost as value floor.',
    tag: 'Monetary Theory',
  },
  {
    title: 'Constitutional DAO Layer',
    desc: 'Governance as constitutional law — immutable axioms with amendable parameters.',
    tag: 'Governance',
  },
]

// ============ Main Component ============
export default function EconomicsPage() {
  const treasurySparkData = useMemo(() => generateSparklineData(7701, 20, 0.025), [])
  const runwaySparkData = useMemo(() => generateSparklineData(7702, 20, 0.015), [])
  const stabilizerSparkData = useMemo(() => generateSparklineData(7703, 20, 0.02), [])
  const insuranceSparkData = useMemo(() => generateSparklineData(7704, 20, 0.03), [])

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="knowledge"
        title="Economics"
        subtitle="Cooperative Capitalism — mutualized risk meets free market competition"
      />

      <div className="space-y-10">
        {/* ============ Section 1: The Two Forces ============ */}
        <section>
          <SectionHeader tag="Equilibrium" title="The Two Forces" delay={0.1} />
          <TwoForcesSection />
        </section>

        {/* ============ Section 2: Fee Flow Diagram ============ */}
        <section>
          <SectionHeader tag="Value Distribution" title="Fee Flow" delay={0.1 / PHI} />
          <FeeFlowSection />
        </section>

        {/* ============ Section 3: Treasury Dashboard ============ */}
        <section>
          <SectionHeader tag="Protocol Health" title="Treasury Dashboard" delay={0.1 / (PHI * PHI)} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
          >
            <StatCard label="Treasury Balance" value={2_450_000} prefix="$" decimals={0} change={4.2} sparkData={treasurySparkData} size="sm" />
            <StatCard label="Runway" value={18.5} suffix=" mo" decimals={1} change={1.8} sparkData={runwaySparkData} size="sm" />
            <StatCard label="Stabilizer Fund" value={820_000} prefix="$" decimals={0} change={2.1} sparkData={stabilizerSparkData} size="sm" />
            <StatCard label="Insurance Pool" value={340_000} prefix="$" decimals={0} change={6.7} sparkData={insuranceSparkData} size="sm" />
          </motion.div>
        </section>

        {/* ============ Section 4: Cooperative Mechanisms ============ */}
        <section>
          <SectionHeader tag="Mutualized Risk" title="Cooperative Mechanisms" delay={0.1} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {COOPERATIVE_MECHANISMS.map((mech, i) => (
              <motion.div
                key={mech.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * (0.1 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
              >
                <GlassCard glowColor="matrix" className="p-4 h-full">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">{mech.icon}</div>
                    <div>
                      <h3 className="text-sm font-mono font-bold text-green-400 mb-1">{mech.title}</h3>
                      <p className="text-[11px] font-mono text-black-400 leading-relaxed">{mech.desc}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ============ Section 5: Competitive Mechanisms ============ */}
        <section>
          <SectionHeader tag="Free Market" title="Competitive Mechanisms" delay={0.1} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {COMPETITIVE_MECHANISMS.map((mech, i) => (
              <motion.div
                key={mech.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * (0.1 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
              >
                <GlassCard glowColor="terminal" className="p-4 h-full">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">{mech.icon}</div>
                    <div>
                      <h3 className="text-sm font-mono font-bold text-blue-400 mb-1">{mech.title}</h3>
                      <p className="text-[11px] font-mono text-black-400 leading-relaxed">{mech.desc}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ============ Section 6: Economic Simulation ============ */}
        <section>
          <SectionHeader tag="What-If Analysis" title="Economic Simulation" delay={0.1} />
          <EconomicSimulation />
        </section>

        {/* ============ Section 7: Key Economic Papers ============ */}
        <section>
          <SectionHeader tag="Foundational Research" title="Key Economic Papers" delay={0.1} />
          <div className="space-y-3">
            {KEY_PAPERS.map((paper, i) => (
              <motion.div
                key={paper.title}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * (0.1 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
              >
                <GlassCard glowColor="warning" hover className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-mono font-bold text-amber-400">{paper.title}</h3>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500/70 border border-amber-500/20">
                          {paper.tag}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-black-400">{paper.desc}</p>
                    </div>
                    <span className="text-amber-400/50 text-sm font-mono shrink-0 ml-3">PDF</span>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ============ Explore More ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 1 / PHI }}
          className="flex flex-wrap justify-center gap-3 pt-4"
        >
          <a href="/jul" className="text-xs font-mono px-3 py-1.5 rounded-full border border-matrix-600/30 text-matrix-400 hover:bg-matrix-600/10 transition-colors">JUL Token</a>
          <a href="/philosophy" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Philosophy</a>
          <a href="/covenants" className="text-xs font-mono px-3 py-1.5 rounded-full border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">Ten Covenants</a>
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
            "Cooperative Capitalism — where self-interest and public good converge by design."
          </p>
        </motion.div>
      </div>
    </div>
  )
}
