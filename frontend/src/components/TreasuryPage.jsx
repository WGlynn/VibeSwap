import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============================================================
// Treasury Page — DAO treasury dashboard showing protocol-owned
// assets, allocations, revenue streams, and stabilizer status.
// Cooperative Capitalism: transparent treasury management.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

const rng = seededRandom(1616)

// ============ Animation Variants ============

const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.1 / PHI, ease: 'easeOut' },
  }),
}

// ============ Treasury Overview Data ============

const TREASURY_OVERVIEW = {
  totalValue: 7_482_300,
  monthlyRevenue: 312_500,
  runwayMonths: 24,
  growthRate: 8.7,
}

// ============ Asset Allocation ============

const ASSET_ALLOCATION = [
  { name: 'VIBE', value: 2_840_000, pct: 0.3795, color: CYAN },
  { name: 'ETH', value: 2_106_000, pct: 0.2815, color: '#a78bfa' },
  { name: 'USDC', value: 1_344_000, pct: 0.1796, color: '#34d399' },
  { name: 'Stablecoins', value: 672_300, pct: 0.0899, color: '#facc15' },
  { name: 'LP Positions', value: 520_000, pct: 0.0695, color: '#f97316' },
]

// ============ Revenue Streams ============

const REVENUE_STREAMS = [
  { name: 'Swap Fees', monthly: 187_500, pct: 60.0, color: CYAN, trend: '+12%' },
  { name: 'Bridge Fees', monthly: 78_125, pct: 25.0, color: '#a78bfa', trend: '+31%' },
  { name: 'Premium Features', monthly: 46_875, pct: 15.0, color: '#34d399', trend: '+8%' },
]

// ============ Expense Categories ============

const EXPENSE_CATEGORIES = [
  { name: 'Development', monthly: 125_000, pct: 48.1, color: CYAN },
  { name: 'Marketing', monthly: 52_000, pct: 20.0, color: '#f97316' },
  { name: 'Grants', monthly: 46_800, pct: 18.0, color: '#a78bfa' },
  { name: 'Operations', monthly: 36_200, pct: 13.9, color: '#facc15' },
]

// ============ Recent Transactions ============

const TRANSACTIONS = (() => {
  const r = seededRandom(1616)
  const types = ['inflow', 'outflow']
  const inflowDescs = [
    'Swap fee revenue — weekly aggregation',
    'Bridge fee collection — LayerZero',
    'Premium subscription batch',
    'LP yield harvest — ETH/USDC',
    'Auction priority bid revenue',
  ]
  const outflowDescs = [
    'Developer salaries — monthly',
    'Audit payment — Trail of Bits',
    'Community grant — Memehunter analytics',
    'Marketing campaign — Q1 push',
    'Infrastructure costs — RPC nodes',
    'Bug bounty payout — critical fix',
  ]
  const txs = []
  for (let i = 0; i < 10; i++) {
    const type = types[Math.floor(r() * 2)]
    const descs = type === 'inflow' ? inflowDescs : outflowDescs
    const desc = descs[Math.floor(r() * descs.length)]
    const amount = type === 'inflow'
      ? Math.floor(r() * 80000) + 15000
      : Math.floor(r() * 60000) + 10000
    const daysAgo = Math.floor(r() * 28) + 1
    const date = new Date(Date.now() - daysAgo * 86400000)
    txs.push({
      id: `TX-${1000 + i}`,
      type,
      description: desc,
      amount,
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: date.getTime(),
    })
  }
  return txs.sort((a, b) => b.timestamp - a.timestamp)
})()

// ============ Stabilizer Status ============

const STABILIZER_STATUS = {
  isActive: true,
  targetReserveRatio: 0.25,
  currentReserveRatio: 0.283,
  lastRebalance: '2 days ago',
  rebalanceThreshold: 0.05,
  reserveBalance: 1_870_575,
  buybackPool: 420_000,
  emissionRate: 12500,
  nextRebalanceEst: '~4 days',
}

// ============ Grant Proposals ============

const GRANT_PROPOSALS = [
  {
    id: 'GR-014',
    title: 'Memehunter Analytics Module',
    requestor: '0xf1C8...e3A0',
    amount: 50_000,
    status: 'approved',
    votes: { for: 842, against: 127 },
    description: 'Smart contract scanner, social sentiment feed, and frontend integration.',
  },
  {
    id: 'GR-015',
    title: 'Mobile SDK for VibeSwap',
    requestor: '0x3bE1...d4F2',
    amount: 75_000,
    status: 'voting',
    votes: { for: 561, against: 203 },
    description: 'Native iOS/Android SDK with biometric signing and push notifications.',
  },
  {
    id: 'GR-016',
    title: 'Cross-chain Arbitrage Bot Toolkit',
    requestor: '0xaB92...1fD7',
    amount: 35_000,
    status: 'pending',
    votes: { for: 0, against: 0 },
    description: 'Open-source toolkit for building MEV-aware arbitrage strategies on VibeSwap.',
  },
]

// ============ Insurance Pool ============

const INSURANCE_POOL = {
  totalBalance: 3_240_000,
  activeCoverage: 2_180_000,
  availableCapacity: 1_060_000,
  utilizationRate: 67.3,
  claimsPaid: 145_000,
  premiumsCollected: 312_000,
  coverageTypes: [
    { name: 'Smart Contract', allocated: 980_000, color: CYAN },
    { name: 'Bridge Exploit', allocated: 650_000, color: '#ef4444' },
    { name: 'Oracle Failure', allocated: 340_000, color: '#f97316' },
    { name: 'Depeg Protection', allocated: 210_000, color: '#a78bfa' },
  ],
}

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div
      custom={index}
      variants={sectionVariants}
      initial="hidden"
      animate="visible"
      className="mb-4"
    >
      <GlassCard glowColor="terminal" hover={false} className="p-5">
        <div className="mb-4">
          <h2 className="text-sm font-bold tracking-wider uppercase" style={{ color: CYAN }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs font-mono text-black-400 mt-1">{subtitle}</p>
          )}
          <div
            className="h-px mt-3"
            style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }}
          />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Stat Card ============

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="text-center p-3 rounded-lg bg-black-900/40">
      <div
        className={`font-mono font-bold text-lg ${accent ? 'text-cyan-400' : 'text-white'}`}
        style={accent ? { textShadow: `0 0 20px ${CYAN}40` } : {}}
      >
        {value}
      </div>
      <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mt-0.5">
        {label}
      </div>
      {sub && (
        <div className="text-[9px] font-mono text-black-600 mt-0.5">{sub}</div>
      )}
    </div>
  )
}

// ============ Animated Progress Bar ============

function ProgressBar({ label, value, total, color, delay = 0, showPct = true }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-mono text-black-500 w-24 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-black-900/80 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8 * PHI, delay, ease: 'easeOut' }}
        />
      </div>
      {showPct && (
        <span className="text-[10px] font-mono text-black-400 w-12 text-right">
          {pct.toFixed(1)}%
        </span>
      )}
    </div>
  )
}

// ============ Donut Chart SVG ============

function DonutChart({ segments, size = 160, innerRadius = 48, outerRadius = 68 }) {
  const cx = size / 2
  const cy = size / 2
  let cumulative = 0

  const arcs = segments.map((seg) => {
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2
    cumulative += seg.pct
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2
    const largeArc = seg.pct > 0.5 ? 1 : 0

    const outerX1 = cx + outerRadius * Math.cos(startAngle)
    const outerY1 = cy + outerRadius * Math.sin(startAngle)
    const outerX2 = cx + outerRadius * Math.cos(endAngle)
    const outerY2 = cy + outerRadius * Math.sin(endAngle)
    const innerX1 = cx + innerRadius * Math.cos(endAngle)
    const innerY1 = cy + innerRadius * Math.sin(endAngle)
    const innerX2 = cx + innerRadius * Math.cos(startAngle)
    const innerY2 = cy + innerRadius * Math.sin(startAngle)

    const d = [
      `M ${outerX1} ${outerY1}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerX2} ${outerY2}`,
      `L ${innerX1} ${innerY1}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerX2} ${innerY2}`,
      'Z',
    ].join(' ')

    return { ...seg, d }
  })

  return (
    <div className="flex items-center gap-5">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-36 h-36 shrink-0">
        {arcs.map((arc, i) => (
          <motion.path
            key={arc.name}
            d={arc.d}
            fill={arc.color}
            opacity={0.85}
            initial={{ scale: 0, transformOrigin: `${cx}px ${cy}px` }}
            animate={{ scale: 1 }}
            transition={{ delay: i * 0.12, duration: 0.5, ease: 'easeOut' }}
          />
        ))}
        <circle cx={cx} cy={cy} r={innerRadius - 4} fill="#0a0a0a" />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill="#fff"
          fontSize="11"
          fontFamily="monospace"
          fontWeight="bold"
        >
          $7.48M
        </text>
        <text
          x={cx}
          y={cy + 8}
          textAnchor="middle"
          fill="#888"
          fontSize="7"
          fontFamily="monospace"
        >
          TOTAL
        </text>
      </svg>
      <div className="space-y-2">
        {arcs.map((arc) => (
          <div key={arc.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: arc.color }} />
            <span className="text-[10px] font-mono text-black-400 w-20">{arc.name}</span>
            <span className="text-[10px] font-mono text-white">
              ${(arc.value / 1_000_000).toFixed(2)}M
            </span>
            <span className="text-[9px] font-mono text-black-600">
              ({(arc.pct * 100).toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Stabilizer Gauge SVG ============

function StabilizerGauge({ current, target, threshold }) {
  const width = 260
  const height = 24
  const margin = 20
  const barW = width - margin * 2
  const barH = 8
  const barY = height / 2 - barH / 2

  const currentX = margin + current * barW
  const targetX = margin + target * barW
  const lowX = margin + (target - threshold) * barW
  const highX = margin + (target + threshold) * barW

  return (
    <svg viewBox={`0 0 ${width} ${height + 16}`} className="w-full h-10">
      <rect x={margin} y={barY} width={barW} height={barH} rx={4} fill="#1a1a1a" />
      <rect x={lowX} y={barY} width={highX - lowX} height={barH} rx={2} fill={`${CYAN}15`} />
      <line x1={targetX} y1={barY - 2} x2={targetX} y2={barY + barH + 2} stroke="#666" strokeWidth="1" strokeDasharray="2 2" />
      <motion.circle
        cx={currentX}
        cy={barY + barH / 2}
        r={5}
        fill={CYAN}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      />
      <motion.circle
        cx={currentX}
        cy={barY + barH / 2}
        r={8}
        fill="none"
        stroke={CYAN}
        strokeWidth="1"
        opacity={0.3}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.6, delay: 0.4 }}
      />
      <text x={targetX} y={barY + barH + 12} textAnchor="middle" fill="#666" fontSize="7" fontFamily="monospace">
        target {(target * 100).toFixed(0)}%
      </text>
      <text x={currentX} y={barY - 5} textAnchor="middle" fill={CYAN} fontSize="7" fontFamily="monospace">
        {(current * 100).toFixed(1)}%
      </text>
    </svg>
  )
}

// ============ Main Component ============

export default function TreasuryPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [txFilter, setTxFilter] = useState('all')
  const [expandedGrant, setExpandedGrant] = useState(null)

  const filteredTxs = useMemo(() => {
    if (txFilter === 'all') return TRANSACTIONS
    return TRANSACTIONS.filter((tx) => tx.type === txFilter)
  }, [txFilter])

  const netFlow = useMemo(() => {
    const inflow = TRANSACTIONS.filter((t) => t.type === 'inflow').reduce((s, t) => s + t.amount, 0)
    const outflow = TRANSACTIONS.filter((t) => t.type === 'outflow').reduce((s, t) => s + t.amount, 0)
    return inflow - outflow
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ============ Page Hero ============ */}
      <PageHero
        title="DAO Treasury"
        subtitle="Protocol-owned assets, revenue allocation, and cooperative fund management."
        category="community"
        badge="Live"
        badgeColor={CYAN}
      />

      {/* ============ 1. Treasury Overview ============ */}
      <Section index={0} title="Treasury Overview" subtitle="Protocol-owned assets at a glance">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Total Value"
            value={`$${(TREASURY_OVERVIEW.totalValue / 1_000_000).toFixed(2)}M`}
            accent
          />
          <StatCard
            label="Monthly Revenue"
            value={`$${(TREASURY_OVERVIEW.monthlyRevenue / 1000).toFixed(0)}K`}
            sub="trailing 30d"
          />
          <StatCard
            label="Runway"
            value={`${TREASURY_OVERVIEW.runwayMonths} mo`}
            sub="at current burn"
          />
          <StatCard
            label="Growth Rate"
            value={`+${TREASURY_OVERVIEW.growthRate}%`}
            sub="month over month"
            accent
          />
        </div>
      </Section>

      {/* ============ 2. Asset Allocation Donut ============ */}
      <Section index={1} title="Asset Allocation" subtitle="Diversified treasury holdings">
        <DonutChart segments={ASSET_ALLOCATION} />
        <div className="mt-3 text-[10px] font-mono text-black-500">
          Treasury diversification targets: 30-40% native token, 25-30% ETH, 15-20% stablecoins, 10-15% yield-bearing positions.
        </div>
      </Section>

      {/* ============ 3. Revenue Streams ============ */}
      <Section index={2} title="Revenue Streams" subtitle="Monthly protocol income breakdown">
        <div className="space-y-3">
          {REVENUE_STREAMS.map((stream, i) => (
            <div key={stream.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono text-white">{stream.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-white">
                    ${(stream.monthly / 1000).toFixed(1)}K
                  </span>
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                    style={{
                      color: '#34d399',
                      background: 'rgba(52,211,153,0.1)',
                      border: '1px solid rgba(52,211,153,0.2)',
                    }}
                  >
                    {stream.trend}
                  </span>
                </div>
              </div>
              <ProgressBar
                label={`${stream.pct}%`}
                value={stream.pct}
                total={100}
                color={stream.color}
                delay={i * 0.1}
                showPct={false}
              />
            </div>
          ))}
          <div className="flex justify-between pt-2 border-t border-black-700/30">
            <span className="text-xs font-mono text-black-400">Total Monthly</span>
            <span className="text-xs font-mono font-bold text-cyan-400">
              ${(TREASURY_OVERVIEW.monthlyRevenue / 1000).toFixed(0)}K
            </span>
          </div>
        </div>
      </Section>

      {/* ============ 4. Expense Categories ============ */}
      <Section index={3} title="Expense Categories" subtitle="Where the treasury funds go">
        <div className="space-y-2.5">
          {EXPENSE_CATEGORIES.map((cat, i) => (
            <div key={cat.name} className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: cat.color }} />
              <span className="text-[10px] font-mono text-black-400 w-24 shrink-0">{cat.name}</span>
              <div className="flex-1 h-2.5 bg-black-900/80 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: cat.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${cat.pct}%` }}
                  transition={{ duration: 0.8 * PHI, delay: i * 0.08, ease: 'easeOut' }}
                />
              </div>
              <span className="text-[10px] font-mono text-white w-14 text-right">
                ${(cat.monthly / 1000).toFixed(0)}K
              </span>
              <span className="text-[9px] font-mono text-black-600 w-10 text-right">
                {cat.pct}%
              </span>
            </div>
          ))}
          <div className="flex justify-between pt-2 border-t border-black-700/30">
            <span className="text-xs font-mono text-black-400">Total Monthly Expenses</span>
            <span className="text-xs font-mono font-bold text-amber-400">
              ${(EXPENSE_CATEGORIES.reduce((s, c) => s + c.monthly, 0) / 1000).toFixed(0)}K
            </span>
          </div>
        </div>
      </Section>

      {/* ============ 5. Treasury Transactions ============ */}
      <Section index={4} title="Recent Transactions" subtitle="Treasury inflows and outflows — last 30 days">
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-2">
            {['all', 'inflow', 'outflow'].map((f) => (
              <button
                key={f}
                onClick={() => setTxFilter(f)}
                className={`px-3 py-1 rounded-lg text-[10px] font-mono font-semibold transition-all border ${
                  txFilter === f
                    ? 'text-cyan-400 border-cyan-800/50 bg-cyan-900/20'
                    : 'text-black-500 border-black-700/30 hover:text-black-300'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <span
            className={`text-[10px] font-mono font-semibold ${
              netFlow >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            Net: {netFlow >= 0 ? '+' : ''}${(netFlow / 1000).toFixed(1)}K
          </span>
        </div>
        <div className="space-y-2">
          {filteredTxs.map((tx, i) => (
            <motion.div
              key={tx.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 / PHI, duration: 0.3 }}
              className="flex items-center justify-between p-3 rounded-lg bg-black-900/30 border border-black-800/30"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: tx.type === 'inflow' ? '#34d399' : '#ef4444',
                    boxShadow: `0 0 6px ${tx.type === 'inflow' ? '#34d39940' : '#ef444440'}`,
                  }}
                />
                <div className="min-w-0">
                  <div className="text-xs font-mono text-white truncate">{tx.description}</div>
                  <div className="text-[10px] font-mono text-black-500">
                    {tx.id} | {tx.date}
                  </div>
                </div>
              </div>
              <span
                className={`text-xs font-mono font-semibold shrink-0 ml-3 ${
                  tx.type === 'inflow' ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {tx.type === 'inflow' ? '+' : '-'}${(tx.amount / 1000).toFixed(1)}K
              </span>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 6. Stabilizer Status ============ */}
      <Section index={5} title="Treasury Stabilizer" subtitle="TreasuryStabilizer.sol — automated reserve management">
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: STABILIZER_STATUS.isActive ? '#34d399' : '#ef4444' }}
            />
            <span className="text-[10px] font-mono text-black-400">
              {STABILIZER_STATUS.isActive ? 'Active — Monitoring reserves' : 'Inactive'}
            </span>
          </div>

          <StabilizerGauge
            current={STABILIZER_STATUS.currentReserveRatio}
            target={STABILIZER_STATUS.targetReserveRatio}
            threshold={STABILIZER_STATUS.rebalanceThreshold}
          />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Reserve Balance"
              value={`$${(STABILIZER_STATUS.reserveBalance / 1_000_000).toFixed(2)}M`}
            />
            <StatCard
              label="Buyback Pool"
              value={`$${(STABILIZER_STATUS.buybackPool / 1000).toFixed(0)}K`}
            />
            <StatCard
              label="Emission Rate"
              value={`${(STABILIZER_STATUS.emissionRate).toLocaleString()}/d`}
              sub="VIBE tokens"
            />
            <StatCard
              label="Last Rebalance"
              value={STABILIZER_STATUS.lastRebalance}
            />
          </div>

          <div className="p-3 rounded-lg bg-black-900/40 border border-black-800/30">
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
              Stabilizer Parameters
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Target Reserve', value: `${(STABILIZER_STATUS.targetReserveRatio * 100).toFixed(0)}%` },
                { label: 'Current Reserve', value: `${(STABILIZER_STATUS.currentReserveRatio * 100).toFixed(1)}%` },
                { label: 'Rebalance Threshold', value: `+/-${(STABILIZER_STATUS.rebalanceThreshold * 100).toFixed(0)}%` },
                { label: 'Next Rebalance', value: STABILIZER_STATUS.nextRebalanceEst },
              ].map((p) => (
                <div key={p.label} className="flex justify-between text-[10px] font-mono">
                  <span className="text-black-500">{p.label}</span>
                  <span className="text-white">{p.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ============ 7. Grant Proposals ============ */}
      <Section index={6} title="Grant Proposals" subtitle="Community-funded development initiatives">
        <div className="space-y-3">
          {GRANT_PROPOSALS.map((grant) => {
            const isExp = expandedGrant === grant.id
            const totalVotes = grant.votes.for + grant.votes.against
            const approval = totalVotes > 0 ? (grant.votes.for / totalVotes) * 100 : 0
            const statusColors = {
              approved: { text: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-800/40' },
              voting: { text: 'text-cyan-400', bg: 'bg-cyan-900/20', border: 'border-cyan-800/40' },
              pending: { text: 'text-amber-400', bg: 'bg-amber-900/20', border: 'border-amber-800/40' },
            }
            const sc = statusColors[grant.status] || statusColors.pending

            return (
              <div
                key={grant.id}
                className="rounded-xl border border-black-700/30 bg-black-900/30 p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-cyan-500/70 tracking-wider">
                        {grant.id}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${sc.text} ${sc.bg} border ${sc.border}`}
                      >
                        {grant.status.toUpperCase()}
                      </span>
                    </div>
                    <h3
                      className="text-white text-sm font-semibold cursor-pointer hover:text-cyan-300 transition-colors"
                      onClick={() => setExpandedGrant(isExp ? null : grant.id)}
                    >
                      {grant.title}
                      <span className="text-black-500 text-[10px] ml-2">
                        {isExp ? '\u25B2' : '\u25BC'}
                      </span>
                    </h3>
                  </div>
                  <span className="text-sm font-mono text-white font-semibold shrink-0 ml-3">
                    ${(grant.amount / 1000).toFixed(0)}K
                  </span>
                </div>

                {totalVotes > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-black-500 w-16 shrink-0">
                        Approval
                      </span>
                      <div className="flex-1 h-2 bg-black-900/80 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: `linear-gradient(90deg, ${CYAN}80, ${CYAN})` }}
                          initial={{ width: 0 }}
                          animate={{ width: `${approval}%` }}
                          transition={{ duration: 0.8 * PHI, ease: 'easeOut' }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-black-400 w-12 text-right">
                        {approval.toFixed(1)}%
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-black-500 mt-1">
                      {grant.votes.for} for / {grant.votes.against} against | Requestor: {grant.requestor}
                    </div>
                  </div>
                )}

                <AnimatePresence>
                  {isExp && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-black-700/30 pt-3 mt-2">
                        <p className="text-black-400 text-xs font-mono leading-relaxed pl-2 border-l-2 border-cyan-800/30">
                          {grant.description}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {grant.status === 'voting' && isConnected && (
                  <div className="flex gap-2 mt-3">
                    <button className="flex-1 py-1.5 text-[11px] font-mono font-semibold rounded-lg border border-cyan-800/40 text-cyan-400 hover:bg-cyan-900/30 transition-all">
                      Vote For
                    </button>
                    <button className="flex-1 py-1.5 text-[11px] font-mono font-semibold rounded-lg border border-red-800/40 text-red-400 hover:bg-red-900/30 transition-all">
                      Vote Against
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* ============ 8. Insurance Pool ============ */}
      <Section index={7} title="Insurance Pool" subtitle="Protocol-backed coverage for users against systemic risk">
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="Pool Balance"
              value={`$${(INSURANCE_POOL.totalBalance / 1_000_000).toFixed(2)}M`}
              accent
            />
            <StatCard
              label="Active Coverage"
              value={`$${(INSURANCE_POOL.activeCoverage / 1_000_000).toFixed(2)}M`}
            />
            <StatCard
              label="Utilization"
              value={`${INSURANCE_POOL.utilizationRate}%`}
              sub={`$${(INSURANCE_POOL.availableCapacity / 1_000_000).toFixed(2)}M available`}
            />
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
              Coverage Allocation
            </div>
            {INSURANCE_POOL.coverageTypes.map((ct, i) => (
              <div key={ct.name} className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ct.color }} />
                <span className="text-[10px] font-mono text-black-400 w-28 shrink-0">{ct.name}</span>
                <div className="flex-1 h-2 bg-black-900/80 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: ct.color }}
                    initial={{ width: 0 }}
                    animate={{
                      width: `${(ct.allocated / INSURANCE_POOL.totalBalance) * 100}%`,
                    }}
                    transition={{ duration: 0.8 * PHI, delay: i * 0.08, ease: 'easeOut' }}
                  />
                </div>
                <span className="text-[10px] font-mono text-white w-14 text-right">
                  ${(ct.allocated / 1000).toFixed(0)}K
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-black-700/30">
            <div className="p-2.5 rounded-lg bg-black-900/40">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
                Claims Paid
              </div>
              <div className="text-sm font-mono font-bold text-red-400 mt-1">
                ${(INSURANCE_POOL.claimsPaid / 1000).toFixed(0)}K
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-black-900/40">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
                Premiums Collected
              </div>
              <div className="text-sm font-mono font-bold text-green-400 mt-1">
                ${(INSURANCE_POOL.premiumsCollected / 1000).toFixed(0)}K
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ============ 9. Treasury Transparency Note ============ */}
      <Section index={8} title="Transparency" subtitle="All treasury operations are on-chain and verifiable">
        <div className="p-3 rounded-lg bg-cyan-900/10 border border-cyan-800/20">
          <div className="text-[11px] font-mono text-black-300 leading-relaxed space-y-2">
            <p>
              The DAO Treasury is governed by a 3-of-5 multi-sig with a 2-day timelock on all withdrawals
              exceeding $10,000. The TreasuryStabilizer contract automatically manages reserve ratios and
              buyback operations.
            </p>
            <p>
              All treasury transactions, grant disbursements, and stabilizer rebalances are executed
              on-chain and require governance proposal approval. Real-time balances are verifiable
              via the treasury contract address.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { label: 'Multi-sig', value: '3/5' },
            { label: 'Timelock', value: '48h' },
            { label: 'On-chain', value: '100%' },
          ].map((item) => (
            <div key={item.label} className="text-center p-2 rounded-lg bg-black-900/40">
              <div className="text-sm font-mono font-bold text-cyan-400">{item.value}</div>
              <div className="text-[9px] font-mono text-black-500 uppercase tracking-wider">
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ============ Wallet CTA ============ */}
      {!isConnected && (
        <motion.div
          className="text-center mt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <div className="text-black-500 text-xs font-mono py-4 border-t border-black-800/50">
            Connect wallet to vote on grant proposals and view your treasury contribution history
          </div>
        </motion.div>
      )}
    </div>
  )
}
