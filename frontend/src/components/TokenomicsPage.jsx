import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const MATRIX = '#00ff41'
const AMBER = '#f59e0b'
const TOTAL_SUPPLY = 21_000_000

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function seededSparkline(seed, length = 20, volatility = 0.05) {
  const rng = seededRandom(seed)
  const data = [50]
  for (let i = 1; i < length; i++) {
    const delta = (rng() - 0.48) * 100 * volatility
    data.push(Math.max(5, Math.min(95, data[i - 1] + delta)))
  }
  return data
}

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 20 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      delay: i * (1 / PHI) * 0.3,
      ease: [0.25, 0.1, 1 / PHI, 1],
    },
  }),
}

// ============ Data ============

const DISTRIBUTION = [
  { label: 'Community', pct: 40, color: MATRIX, desc: 'Community incentives, ecosystem growth' },
  { label: 'Treasury', pct: 20, color: '#8b5cf6', desc: 'DAO-governed reserve for protocol development' },
  { label: 'Team', pct: 15, color: '#f97316', desc: '4-year vest, 1-year cliff, linear unlock' },
  { label: 'Liquidity Mining', pct: 15, color: CYAN, desc: 'LP rewards across all supported chains' },
  { label: 'Ecosystem Fund', pct: 10, color: AMBER, desc: 'Partnerships, integrations, grants' },
]

const EMISSION_YEARS = [
  { year: 1, tokens: 10_500_000, cumulative: 10_500_000 },
  { year: 2, tokens: 5_250_000, cumulative: 15_750_000 },
  { year: 3, tokens: 2_625_000, cumulative: 18_375_000 },
  { year: 4, tokens: 1_312_500, cumulative: 19_687_500 },
  { year: 5, tokens: 656_250, cumulative: 20_343_750 },
]

const ACCRUAL_CARDS = [
  { title: 'Zero Protocol Fees', value: '0%', desc: 'Zero protocol fees on swaps — 100% of LP fees go to liquidity providers.', color: MATRIX, icon: '\u2694' },
  { title: 'Buyback & Burn', value: '15%', desc: 'Of priority bid revenue used to buy VIBE on open market and send to dead address.', color: '#ef4444', icon: '\uD83D\uDD25' },
  { title: 'Staking Rewards', value: '8-14%', desc: 'Real yield from priority bid revenue and emissions. Lock longer for higher APR.', color: CYAN, icon: '\u26A1' },
  { title: 'Governance Power', value: '1:1', desc: 'Staked VIBE = voting weight. Quadratic scaling prevents whale domination.', color: '#8b5cf6', icon: '\u2696' },
]

const VESTING_SCHEDULE = [
  { group: 'Team', cliff: 12, linear: 36, total: 48, pct: 15, color: '#f97316' },
  { group: 'Investors', cliff: 6, linear: 30, total: 36, pct: 8, color: '#8b5cf6' },
  { group: 'Advisors', cliff: 6, linear: 18, total: 24, pct: 3, color: CYAN },
  { group: 'Ecosystem Fund', cliff: 0, linear: 48, total: 48, pct: 10, color: AMBER },
]

const INFLATIONARY_FORCES = [
  { name: 'Liquidity Mining', rate: '+18.75M', desc: 'LP rewards distributed per epoch to active pools' },
  { name: 'Staking Emissions', rate: '+6.25M', desc: 'Additional VIBE minted for long-term stakers' },
  { name: 'Ecosystem Grants', rate: '+3.12M', desc: 'Developer and partnership grants from ecosystem fund' },
]

const DEFLATIONARY_FORCES = [
  { name: 'Fee Burns', rate: '-4.5M', desc: '15% of all swap fees used for buyback and burn' },
  { name: 'Slashing', rate: '-1.2M', desc: '50% slashing penalty on invalid commit-reveal orders' },
  { name: 'Expired Commits', rate: '-0.8M', desc: 'Unrevealed commit deposits forfeited and burned' },
]

const COMPARISON = [
  { f: 'Max Supply', vibe: '21M (Bitcoin-aligned hard cap)', uni: '1B (fixed)', cake: 'Uncapped (deflationary)', crv: '3.03B (inflationary)' },
  { f: 'Fee Sharing', vibe: '100% LP fees to LPs', uni: 'None (fee switch off)', cake: 'Burn only', crv: '50% to veCRV' },
  { f: 'Burn Mechanism', vibe: '15% of auction revenue burned', uni: 'No burns', cake: 'Weekly manual burns', crv: 'No burns' },
  { f: 'Governance', vibe: 'Quadratic + time-weight', uni: '1 token = 1 vote', cake: 'Snapshot voting', crv: 'veCRV lock 4yr' },
  { f: 'Vesting', vibe: '4yr vest, 1yr cliff', uni: '4yr vest (team)', cake: 'No team vesting', crv: 'Continuous emission' },
  { f: 'MEV Protection', vibe: 'Commit-reveal batches', uni: 'None', cake: 'None', crv: 'None' },
  { f: 'Cross-chain', vibe: 'Native (LayerZero)', uni: 'Bridge dependent', cake: 'BSC + some L2s', crv: 'Bridge dependent' },
  { f: 'Real Yield', vibe: 'Yes (priority bid revenue)', uni: 'No', cake: 'Partial (staking)', crv: 'Yes (trading fees)' },
]

// ============ SVG Pie Chart ============

function PieChart({ data, size = 220 }) {
  const [hovered, setHovered] = useState(null)
  const cx = size / 2, cy = size / 2, r = size * 0.38

  const slices = useMemo(() => {
    let start = -90
    return data.map((d) => {
      const angle = (d.pct / 100) * 360
      const end = start + angle
      const sRad = (start * Math.PI) / 180
      const eRad = (end * Math.PI) / 180
      const mRad = ((start + angle / 2) * Math.PI) / 180
      const large = angle > 180 ? 1 : 0
      const path = [
        `M ${cx} ${cy}`,
        `L ${cx + r * Math.cos(sRad)} ${cy + r * Math.sin(sRad)}`,
        `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(eRad)} ${cy + r * Math.sin(eRad)}`,
        'Z',
      ].join(' ')
      const lx = cx + r * 0.65 * Math.cos(mRad)
      const ly = cy + r * 0.65 * Math.sin(mRad)
      start = end
      return { ...d, path, lx, ly }
    })
  }, [data, cx, cy, r])

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[250px] mx-auto">
        {slices.map((s, i) => (
          <g key={s.label}>
            <motion.path
              d={s.path}
              fill={s.color}
              fillOpacity={hovered === null || hovered === i ? 0.85 : 0.25}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={1}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              whileHover={{ scale: 1.05 }}
              style={{ transformOrigin: `${cx}px ${cy}px`, cursor: 'pointer' }}
              transition={{ duration: 0.2 }}
            />
            <text
              x={s.lx} y={s.ly}
              textAnchor="middle" dominantBaseline="central"
              fill="white" fontSize={size * 0.045}
              fontFamily="monospace" fontWeight="bold"
              className="pointer-events-none select-none"
            >
              {s.pct}%
            </text>
          </g>
        ))}
        <circle cx={cx} cy={cy} r={r * 0.32} fill="#0a0a0a" />
        <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize={size * 0.065} fontFamily="monospace" fontWeight="bold" className="select-none">VIBE</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#6b7280" fontSize={size * 0.035} fontFamily="monospace" className="select-none">21M Supply</text>
      </svg>
      {hovered !== null && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-2 bg-black-900/95 border border-black-700 rounded-lg px-3 py-2 text-center pointer-events-none z-20">
          <p className="text-xs font-mono font-bold" style={{ color: slices[hovered].color }}>{slices[hovered].label}</p>
          <p className="text-[10px] font-mono text-black-400">{slices[hovered].desc}</p>
          <p className="text-sm font-mono font-bold text-white">{(TOTAL_SUPPLY * slices[hovered].pct / 100).toLocaleString()} VIBE</p>
        </div>
      )}
    </div>
  )
}

// ============ SVG Emission Chart ============

function EmissionChart({ data }) {
  const W = 440, H = 200, pad = { t: 20, r: 30, b: 35, l: 55 }
  const w = W - pad.l - pad.r, h = H - pad.t - pad.b
  const maxT = Math.max(...data.map(d => d.tokens))
  const currentYear = 1.3

  const bars = data.map((d, i) => {
    const bW = (w / data.length) * 0.55
    const bH = (d.tokens / maxT) * h
    const x = pad.l + (w / data.length) * i + (w / data.length) * 0.225
    const y = pad.t + h - bH
    return { ...d, bW, bH, x, y }
  })

  const cumLine = data.map((d, i) => {
    const x = pad.l + (w / data.length) * i + (w / data.length) * 0.5
    const y = pad.t + h - (d.cumulative / TOTAL_SUPPLY) * h
    return `${x},${y}`
  }).join(' ')

  const markerX = pad.l + (w / data.length) * (currentYear - 1) + (w / data.length) * 0.5

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 100, 200, 300, 400].map(v => {
        const y = pad.t + h - (v / 400) * h
        return (
          <g key={v}>
            <line x1={pad.l} y1={y} x2={pad.l + w} y2={y} stroke="rgba(255,255,255,0.05)" />
            <text x={pad.l - 8} y={y + 3} textAnchor="end" fill="#6b7280" fontSize="9" fontFamily="monospace">{v}M</text>
          </g>
        )
      })}
      {bars.map((b, i) => (
        <g key={b.year}>
          <motion.rect
            x={b.x} width={b.bW} rx={3} fill={MATRIX} fillOpacity={0.6 - i * 0.08}
            initial={{ y: pad.t + h, height: 0 }}
            animate={{ y: b.y, height: b.bH }}
            transition={{ delay: 0.3 + i * 0.12, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          />
          <text x={b.x + b.bW / 2} y={pad.t + h + 16} textAnchor="middle" fill="#9ca3af" fontSize="10" fontFamily="monospace">Y{b.year}</text>
          <text x={b.x + b.bW / 2} y={b.y - 6} textAnchor="middle" fill={MATRIX} fontSize="9" fontFamily="monospace">{(b.tokens / 1e6).toFixed(0)}M</text>
        </g>
      ))}
      <motion.polyline points={cumLine} fill="none" stroke={AMBER} strokeWidth={2} strokeDasharray="4 2"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 0.6 }} />
      {/* Current position marker */}
      <motion.line x1={markerX} y1={pad.t} x2={markerX} y2={pad.t + h} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 3"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} />
      <motion.text x={markerX} y={pad.t - 4} textAnchor="middle" fill="#ef4444" fontSize="8" fontFamily="monospace" fontWeight="bold"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }}>NOW</motion.text>
      {/* Legend */}
      <rect x={W - 120} y={4} width={8} height={8} rx={2} fill={MATRIX} fillOpacity={0.6} />
      <text x={W - 108} y={12} fill="#9ca3af" fontSize="8" fontFamily="monospace">Annual emission</text>
      <line x1={W - 120} y1={22} x2={W - 112} y2={22} stroke={AMBER} strokeWidth={2} strokeDasharray="4 2" />
      <text x={W - 108} y={25} fill="#9ca3af" fontSize="8" fontFamily="monospace">Cumulative</text>
    </svg>
  )
}

// ============ Vesting Timeline SVG ============

function VestingTimeline({ schedule }) {
  const W = 440, H = 140, pad = { t: 10, r: 20, b: 25, l: 90 }
  const w = W - pad.l - pad.r
  const maxMonths = 48
  const rowH = (H - pad.t - pad.b) / schedule.length

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 12, 24, 36, 48].map(m => {
        const x = pad.l + (m / maxMonths) * w
        return (
          <g key={m}>
            <line x1={x} y1={pad.t} x2={x} y2={H - pad.b} stroke="rgba(255,255,255,0.06)" />
            <text x={x} y={H - pad.b + 14} textAnchor="middle" fill="#6b7280" fontSize="8" fontFamily="monospace">{m}mo</text>
          </g>
        )
      })}
      {schedule.map((s, i) => {
        const y = pad.t + i * rowH + rowH * 0.3
        const barH = rowH * 0.4
        const cliffX = pad.l + (s.cliff / maxMonths) * w
        const endX = pad.l + (s.total / maxMonths) * w
        return (
          <g key={s.group}>
            <text x={pad.l - 8} y={y + barH / 2 + 3} textAnchor="end" fill="#9ca3af" fontSize="9" fontFamily="monospace">{s.group}</text>
            {/* Cliff period */}
            {s.cliff > 0 && (
              <motion.rect x={pad.l} y={y} width={cliffX - pad.l} height={barH} rx={3}
                fill={s.color} fillOpacity={0.15}
                initial={{ width: 0 }} animate={{ width: cliffX - pad.l }}
                transition={{ delay: 0.4 + i * 0.15, duration: 0.5 }} />
            )}
            {/* Linear vesting */}
            <motion.rect x={cliffX} y={y} width={0} height={barH} rx={3}
              fill={s.color} fillOpacity={0.5}
              animate={{ width: endX - cliffX }}
              transition={{ delay: 0.6 + i * 0.15, duration: 0.6 }} />
            {/* Cliff marker */}
            {s.cliff > 0 && (
              <motion.line x1={cliffX} y1={y - 2} x2={cliffX} y2={y + barH + 2}
                stroke={s.color} strokeWidth={2}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.8 + i * 0.15 }} />
            )}
            <text x={endX + 6} y={y + barH / 2 + 3} fill={s.color} fontSize="8" fontFamily="monospace" fontWeight="bold">{s.pct}%</text>
          </g>
        )
      })}
    </svg>
  )
}

// ============ Main Component ============

export default function TokenomicsPage() {
  const [supplyMode, setSupplyMode] = useState('both')
  const [highlightCol, setHighlightCol] = useState(null)

  const cols = ['vibe', 'uni', 'cake', 'crv']
  const colLabels = { vibe: 'VIBE', uni: 'UNI', cake: 'CAKE', crv: 'CRV' }
  const colColors = { vibe: MATRIX, uni: '#ff007a', cake: '#d4a017', crv: '#f97316' }

  const netSupplyChange = useMemo(() => {
    const inflate = 18.75 + 6.25 + 3.12
    const deflate = 4.5 + 1.2 + 0.8
    return { inflate, deflate, net: inflate - deflate }
  }, [])

  return (
    <div className="min-h-screen pb-20">
      <PageHero
        category="knowledge"
        title="VIBE Tokenomics"
        subtitle="Supply, distribution, and value accrual mechanics"
      />

      <div className="max-w-4xl mx-auto px-4 space-y-6">

        {/* ============ Section 1: Token Stats ============ */}
        <motion.div
          variants={sectionV} custom={0}
          initial="hidden" animate="visible"
          className="grid grid-cols-2 lg:grid-cols-3 gap-3"
        >
          <StatCard label="Total Supply" value={TOTAL_SUPPLY} decimals={0} sparkData={seededSparkline(314)} change={0} />
          <StatCard label="Circulating" value={420_000_000} decimals={0} sparkData={seededSparkline(271)} change={2.4} />
          <StatCard label="Staked" value={180_000_000} decimals={0} sparkData={seededSparkline(618)} change={5.1} />
          <StatCard label="Burned" value={12_000_000} decimals={0} sparkData={seededSparkline(161)} change={8.3} />
          <StatCard label="Market Cap" value={315_000_000} prefix="$" decimals={0} sparkData={seededSparkline(420)} change={12.7} />
          <StatCard label="FDV" value={750_000_000} prefix="$" decimals={0} sparkData={seededSparkline(777)} change={4.2} />
        </motion.div>

        {/* ============ Section 2: Distribution Pie Chart ============ */}
        <motion.div variants={sectionV} custom={1} initial="hidden" animate="visible">
          <GlassCard glowColor="matrix" spotlight className="p-5 md:p-6">
            <h2 className="text-lg font-bold font-mono text-white mb-1">Token Distribution</h2>
            <p className="text-xs font-mono text-black-500 mb-5">21,000,000 VIBE — Bitcoin-aligned hard cap with halving emission schedule</p>
            <div className="flex flex-col md:flex-row items-center gap-6">
              <PieChart data={DISTRIBUTION} />
              <div className="flex-1 space-y-3 w-full">
                {DISTRIBUTION.map((d) => (
                  <div key={d.label} className="flex items-start gap-3">
                    <div className="w-3 h-3 rounded-sm shrink-0 mt-0.5" style={{ backgroundColor: d.color }} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-mono font-bold text-white">{d.label}</span>
                        <span className="text-sm font-mono font-bold" style={{ color: d.color }}>{d.pct}%</span>
                      </div>
                      <p className="text-[10px] font-mono text-black-500 leading-relaxed">{d.desc}</p>
                      <p className="text-[10px] font-mono text-black-600">{(TOTAL_SUPPLY * d.pct / 100).toLocaleString()} VIBE</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Section 3: Emission Schedule ============ */}
        <motion.div variants={sectionV} custom={2} initial="hidden" animate="visible">
          <GlassCard glowColor="matrix" spotlight className="p-5 md:p-6">
            <h2 className="text-lg font-bold font-mono text-white mb-1">Emission Schedule</h2>
            <p className="text-xs font-mono text-black-500 mb-4">Halving every year over 5 years — front-loaded for bootstrapping, tapering for scarcity</p>
            <EmissionChart data={EMISSION_YEARS} />
            <div className="grid grid-cols-5 gap-2 mt-4">
              {EMISSION_YEARS.map((e, i) => (
                <div key={e.year} className={`rounded-lg p-2 border text-center ${i === 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-black-900/50 border-black-700/50'}`}>
                  <p className="text-[10px] font-mono text-black-500 uppercase">Year {e.year}</p>
                  <p className="text-sm font-mono font-bold" style={{ color: i === 0 ? MATRIX : CYAN }}>{(e.tokens / 1e6).toFixed(0)}M</p>
                  <p className="text-[9px] font-mono text-black-600">{((e.tokens / TOTAL_SUPPLY) * 100).toFixed(1)}%</p>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Section 4: Value Accrual Mechanics ============ */}
        <motion.div variants={sectionV} custom={3} initial="hidden" animate="visible">
          <h2 className="text-lg font-bold font-mono text-white mb-1">Value Accrual Mechanics</h2>
          <p className="text-xs font-mono text-black-500 mb-4">Four engines driving VIBE value — real yield, not inflationary rewards</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ACCRUAL_CARDS.map((card, i) => (
              <motion.div key={card.title} variants={sectionV} custom={3 + i * 0.3} initial="hidden" animate="visible">
                <GlassCard glowColor="matrix" hover spotlight className="p-4 h-full">
                  <div className="flex items-start gap-3">
                    <span className="text-xl shrink-0">{card.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-mono font-bold" style={{ color: card.color }}>{card.title}</h3>
                        <span className="text-lg font-mono font-bold" style={{ color: card.color }}>{card.value}</span>
                      </div>
                      <p className="text-[11px] font-mono text-black-400 leading-relaxed">{card.desc}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ============ Section 5: Vesting Schedule ============ */}
        <motion.div variants={sectionV} custom={5} initial="hidden" animate="visible">
          <GlassCard glowColor="warning" spotlight className="p-5 md:p-6">
            <h2 className="text-lg font-bold font-mono text-white mb-1">Vesting Schedule</h2>
            <p className="text-xs font-mono text-black-500 mb-4">Team and investor tokens locked with cliff + linear vesting — no rugpull risk</p>
            <VestingTimeline schedule={VESTING_SCHEDULE} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              {VESTING_SCHEDULE.map((s) => (
                <div key={s.group} className="bg-black-900/50 rounded-lg p-2.5 border border-black-700/50 text-center">
                  <div className="w-2 h-2 rounded-full mx-auto mb-1.5" style={{ backgroundColor: s.color }} />
                  <p className="text-xs font-mono font-bold text-white">{s.group}</p>
                  <p className="text-[10px] font-mono text-black-500">
                    {s.cliff > 0 ? `${s.cliff}mo cliff` : 'No cliff'}
                  </p>
                  <p className="text-[10px] font-mono" style={{ color: s.color }}>
                    {s.linear}mo linear &rarr; {s.total}mo total
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 bg-amber-500/5 rounded-lg p-3 border border-amber-500/20">
              <p className="text-[11px] font-mono text-black-400 leading-relaxed text-center">
                <span style={{ color: AMBER }} className="font-bold">Alignment guarantee:</span>{' '}
                Team tokens fully locked for 12 months. No early dumps. Interests aligned with community for the full 4-year journey.
              </p>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Section 6: Supply Dynamics ============ */}
        <motion.div variants={sectionV} custom={6} initial="hidden" animate="visible">
          <GlassCard glowColor="matrix" spotlight className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold font-mono text-white mb-1">Supply Dynamics</h2>
                <p className="text-xs font-mono text-black-500">Inflationary vs deflationary forces — per epoch breakdown</p>
              </div>
              <div className="flex gap-1 bg-black-900/80 rounded-lg p-0.5 border border-black-700/50">
                {[
                  { key: 'inflate', label: 'Inflate', color: MATRIX },
                  { key: 'both', label: 'Both', color: CYAN },
                  { key: 'deflate', label: 'Deflate', color: '#ef4444' },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setSupplyMode(t.key)}
                    className={`px-3 py-1 text-[10px] font-mono rounded-md transition-all ${
                      supplyMode === t.key
                        ? 'text-white font-bold'
                        : 'text-black-500 hover:text-black-300'
                    }`}
                    style={supplyMode === t.key ? { backgroundColor: t.color + '20', color: t.color } : {}}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Inflationary */}
              {(supplyMode === 'inflate' || supplyMode === 'both') && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <p className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: MATRIX }}>
                    Inflationary (per epoch)
                  </p>
                  <div className="space-y-2">
                    {INFLATIONARY_FORCES.map((f) => (
                      <div key={f.name} className="flex items-center gap-3 bg-black-900/50 rounded-lg p-2.5 border border-green-500/10">
                        <span className="text-sm font-mono font-bold shrink-0" style={{ color: MATRIX }}>{f.rate}</span>
                        <div>
                          <p className="text-xs font-mono text-white font-bold">{f.name}</p>
                          <p className="text-[10px] font-mono text-black-500">{f.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Deflationary */}
              {(supplyMode === 'deflate' || supplyMode === 'both') && (
                <motion.div
                  initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <p className="text-[10px] font-mono uppercase tracking-wider text-red-400 mb-3">
                    Deflationary (per epoch)
                  </p>
                  <div className="space-y-2">
                    {DEFLATIONARY_FORCES.map((f) => (
                      <div key={f.name} className="flex items-center gap-3 bg-black-900/50 rounded-lg p-2.5 border border-red-500/10">
                        <span className="text-sm font-mono font-bold text-red-400 shrink-0">{f.rate}</span>
                        <div>
                          <p className="text-xs font-mono text-white font-bold">{f.name}</p>
                          <p className="text-[10px] font-mono text-black-500">{f.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Net supply change */}
            <div className="mt-4 bg-black-900/70 rounded-lg p-4 border border-black-700/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Net Supply Change Per Epoch</p>
                  <p className="text-xl font-mono font-bold" style={{ color: AMBER }}>
                    +{netSupplyChange.net.toFixed(2)}M VIBE
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-[10px] font-mono">
                    <span style={{ color: MATRIX }}>+{netSupplyChange.inflate.toFixed(2)}M</span>
                    <span className="text-black-600"> minted</span>
                  </p>
                  <p className="text-[10px] font-mono">
                    <span className="text-red-400">-{netSupplyChange.deflate.toFixed(2)}M</span>
                    <span className="text-black-600"> burned</span>
                  </p>
                </div>
              </div>
              <div className="mt-2 h-2 bg-black-800 rounded-full overflow-hidden flex">
                <div className="h-full rounded-l-full" style={{ width: `${(netSupplyChange.deflate / netSupplyChange.inflate) * 100}%`, backgroundColor: '#ef4444' }} />
                <div className="h-full rounded-r-full flex-1" style={{ backgroundColor: MATRIX + '40' }} />
              </div>
              <p className="text-[9px] font-mono text-black-600 mt-1 text-center">
                {((netSupplyChange.deflate / netSupplyChange.inflate) * 100).toFixed(1)}% of emissions burned — trending toward deflationary as volume grows
              </p>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Section 7: Comparison Table ============ */}
        <motion.div variants={sectionV} custom={7} initial="hidden" animate="visible">
          <GlassCard glowColor="matrix" spotlight className="p-5 md:p-6">
            <h2 className="text-lg font-bold font-mono text-white mb-1">Tokenomics Comparison</h2>
            <p className="text-xs font-mono text-black-500 mb-4">VIBE vs UNI vs CAKE vs CRV — what sets us apart</p>
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="text-[10px] font-mono text-black-500 uppercase tracking-wider p-2 w-[110px]">Feature</th>
                    {cols.map((c) => (
                      <th
                        key={c}
                        className="text-[10px] font-mono uppercase tracking-wider p-2 text-center cursor-pointer transition-opacity"
                        style={{ color: colColors[c], opacity: highlightCol === null || highlightCol === c ? 1 : 0.35 }}
                        onMouseEnter={() => setHighlightCol(c)}
                        onMouseLeave={() => setHighlightCol(null)}
                      >
                        {colLabels[c]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row, i) => (
                    <motion.tr
                      key={row.f}
                      variants={sectionV} custom={7.5 + i * 0.1}
                      initial="hidden" animate="visible"
                      className="border-t border-black-800/50"
                    >
                      <td className="text-[11px] font-mono text-black-400 p-2 font-bold">{row.f}</td>
                      {cols.map((c) => (
                        <td
                          key={c}
                          className="text-[10px] font-mono p-2 text-center transition-all"
                          style={{
                            color: highlightCol === c ? colColors[c] : (c === 'vibe' ? MATRIX : '#9ca3af'),
                            opacity: highlightCol === null || highlightCol === c ? 1 : 0.3,
                          }}
                        >
                          {row[c]}
                        </td>
                      ))}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 bg-green-500/5 rounded-lg p-3 border border-green-500/20">
              <p className="text-[11px] font-mono text-black-400 text-center leading-relaxed">
                VIBE combines <span style={{ color: MATRIX }} className="font-bold">real fee-sharing</span> (like CRV),{' '}
                <span style={{ color: AMBER }} className="font-bold">active burns</span> (like CAKE),
                and <span style={{ color: CYAN }} className="font-bold">governance</span> (like UNI) — plus commit-reveal MEV protection and native cross-chain via LayerZero.
              </p>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div variants={sectionV} custom={9} initial="hidden" animate="visible" className="text-center pt-6 pb-4">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${MATRIX}40)` }} />
            <div className="flex gap-1.5">
              {[0.3, 0.6, 1, 0.6, 0.3].map((o, i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: MATRIX, opacity: o }} />
              ))}
            </div>
            <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${MATRIX}40, transparent)` }} />
          </div>
          <p className="text-sm font-mono text-black-400 italic max-w-lg mx-auto leading-relaxed mb-2">
            "The greatest idea can't be stolen because part of it is admitting who came up with it."
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            {[
              { href: '/jul', label: 'JUL Token', color: 'green' },
              { href: '/staking', label: 'Stake VIBE', color: 'amber' },
              { href: '/governance', label: 'Governance', color: 'purple' },
              { href: '/economics', label: 'Economics', color: 'cyan' },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={`text-xs font-mono px-3 py-1.5 rounded-full border border-${l.color}-500/30 text-${l.color}-400 hover:bg-${l.color}-500/10 transition-colors`}
              >
                {l.label} &rarr;
              </a>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
