import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const AMBER = '#f59e0b'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 20 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * (0.1 / PHI), duration: 1 / PHI, ease: 'easeOut' },
  }),
}

// ============ Tier Configuration ============

const TIERS = [
  { name: 'Bronze',  minRefs: 0,  maxRefs: 9,   commission: 5,  color: '#cd7f32', icon: 'B', benefits: ['5% commission', 'Basic analytics', 'Standard link'] },
  { name: 'Silver',  minRefs: 10, maxRefs: 29,  commission: 10, color: '#c0c0c0', icon: 'S', benefits: ['10% commission', 'Depth-2 tracking', 'Custom slugs'] },
  { name: 'Gold',    minRefs: 30, maxRefs: 74,  commission: 15, color: '#ffd700', icon: 'G', benefits: ['15% commission', 'Full tree view', 'Priority support', 'QR branding'] },
  { name: 'Diamond', minRefs: 75, maxRefs: null, commission: 25, color: '#b9f2ff', icon: 'D', benefits: ['25% commission', 'API access', 'White-label links', 'Gas subsidized claims', 'VIP badge'] },
]

// ============ Mock Data Generation ============

function generateAddress(rng) {
  const hex = '0123456789abcdef'
  let addr = '0x'
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(rng() * 16)]
  return addr
}

function shortenAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function generateReferralTree(rng) {
  const depth1Count = 8
  const depth1 = []
  for (let i = 0; i < depth1Count; i++) {
    const addr = generateAddress(rng)
    const daysAgo = Math.floor(rng() * 60) + 1
    const joinDate = new Date(Date.now() - daysAgo * 86400000)
    const volume = Math.round((50_000 + rng() * 300_000) * 100) / 100
    const commission = Math.round(volume * 0.003 * 100) / 100
    const isActive = daysAgo < 30
    const subCount = Math.floor(rng() * 4)
    const subs = []
    for (let j = 0; j < subCount; j++) {
      const subAddr = generateAddress(rng)
      const subDaysAgo = Math.floor(rng() * 30) + 1
      const subJoinDate = new Date(Date.now() - subDaysAgo * 86400000)
      const subVolume = Math.round((5_000 + rng() * 80_000) * 100) / 100
      const subCommission = Math.round(subVolume * 0.001 * 100) / 100
      subs.push({
        address: subAddr,
        joinDate: subJoinDate.toISOString().split('T')[0],
        volume: subVolume,
        commission: subCommission,
        isActive: subDaysAgo < 30,
      })
    }
    depth1.push({
      address: addr,
      joinDate: joinDate.toISOString().split('T')[0],
      volume,
      commission,
      isActive,
      depth2: subs,
    })
  }
  return depth1
}

function generateEarningsData(rng, mode) {
  const points = mode === 'daily' ? 30 : mode === 'weekly' ? 12 : 6
  const data = []
  let cumulative = 0
  for (let i = 0; i < points; i++) {
    const base = mode === 'daily' ? 20 + rng() * 80 : mode === 'weekly' ? 140 + rng() * 400 : 600 + rng() * 1600
    const value = Math.round(base * 100) / 100
    cumulative += value
    const label = mode === 'daily'
      ? `${points - i}d`
      : mode === 'weekly'
        ? `W${points - i}`
        : `M${points - i}`
    data.push({ label, value, cumulative: Math.round(cumulative * 100) / 100 })
  }
  return data
}

function generateLeaderboard(rng) {
  const entries = []
  for (let i = 0; i < 10; i++) {
    const addr = generateAddress(rng)
    const referrals = Math.floor(200 - i * 15 + rng() * 30)
    const volume = Math.round((2_000_000 - i * 160_000 + rng() * 300_000) * 100) / 100
    const earnings = Math.round(volume * 0.003 * 100) / 100
    entries.push({ rank: i + 1, address: addr, referrals, volume, earnings })
  }
  return entries
}

function generateLinks(rng) {
  return [
    { slug: 'vibeswap.io/ref/0x1234', clicks: Math.floor(340 + rng() * 200), conversions: Math.floor(24 + rng() * 12), created: '2026-01-15', isDefault: true },
    { slug: 'vibeswap.io/ref/defi-crew', clicks: Math.floor(120 + rng() * 100), conversions: Math.floor(8 + rng() * 6), created: '2026-02-08', isDefault: false },
    { slug: 'vibeswap.io/ref/twitter-bio', clicks: Math.floor(80 + rng() * 60), conversions: Math.floor(3 + rng() * 5), created: '2026-03-01', isDefault: false },
  ]
}

// ============ Helpers ============

function fmtCurrency(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtJUL(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(2)
}

// ============ Section Wrapper ============

function Section({ index, tag, title, children }) {
  return (
    <motion.section
      custom={index}
      variants={sectionV}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
    >
      <div className="mb-3">
        <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">{tag}</span>
        <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
      </div>
      {children}
    </motion.section>
  )
}

// ============ Rank Badge ============

const RANK_COLORS = {
  1: { bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.3)', text: '#eab308' },
  2: { bg: 'rgba(156,163,175,0.15)', border: 'rgba(156,163,175,0.3)', text: '#9ca3af' },
  3: { bg: 'rgba(180,83,9,0.15)', border: 'rgba(180,83,9,0.3)', text: '#b45309' },
}

function RankBadge({ rank }) {
  const medal = RANK_COLORS[rank]
  if (medal) {
    return (
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
        style={{ background: medal.bg, border: `1px solid ${medal.border}`, color: medal.text }}
      >
        {rank}
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-lg flex items-center justify-center font-mono text-sm text-gray-500 bg-gray-800/40 border border-gray-700/30">
      {rank}
    </div>
  )
}

// ============ SVG Area Chart ============

function EarningsChart({ data, color = AMBER }) {
  const width = 600
  const height = 200
  const padding = { top: 20, right: 20, bottom: 30, left: 50 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const maxVal = Math.max(...data.map((d) => d.value), 1)
  const points = data.map((d, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartW,
    y: padding.top + chartH - (d.value / maxVal) * chartH,
    ...d,
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`

  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.6" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {gridLines.map((g, i) => {
        const y = padding.top + chartH * (1 - g)
        return (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">
              {fmtJUL(maxVal * g)}
            </text>
          </g>
        )
      })}
      {/* Area */}
      <motion.path
        d={areaPath}
        fill="url(#areaFill)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1 / PHI, delay: 0.2 }}
      />
      {/* Line */}
      <motion.path
        d={linePath}
        fill="none"
        stroke="url(#lineGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, delay: 0.1, ease: 'easeOut' }}
      />
      {/* Data points */}
      {points.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="3"
          fill={color}
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="1"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 + i * 0.03, duration: 0.3 }}
        />
      ))}
      {/* X-axis labels */}
      {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1).map((p, i) => (
        <text key={i} x={p.x} y={height - 6} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="9" fontFamily="monospace">
          {p.label}
        </text>
      ))}
    </svg>
  )
}

// ============ QR Code (Simple SVG) ============

function SimpleQR({ value, size = 120 }) {
  const rng = seededRandom(value.split('').reduce((a, c) => a + c.charCodeAt(0), 0))
  const modules = 21
  const cellSize = size / modules
  const cells = []
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      const isCorner =
        (r < 7 && c < 7) ||
        (r < 7 && c >= modules - 7) ||
        (r >= modules - 7 && c < 7)
      const isCornerInner =
        (r >= 2 && r <= 4 && c >= 2 && c <= 4) ||
        (r >= 2 && r <= 4 && c >= modules - 5 && c <= modules - 3) ||
        (r >= modules - 5 && r <= modules - 3 && c >= 2 && c <= 4)
      const isCornerBorder =
        (r === 0 || r === 6 || c === 0 || c === 6) && r < 7 && c < 7 ||
        (r === 0 || r === 6 || c === modules - 1 || c === modules - 7) && r < 7 && c >= modules - 7 ||
        (r === modules - 1 || r === modules - 7 || c === 0 || c === 6) && r >= modules - 7 && c < 7
      const filled = isCornerInner || isCornerBorder || (!isCorner && rng() > 0.45)
      if (filled) {
        cells.push(
          <rect key={`${r}-${c}`} x={c * cellSize} y={r * cellSize} width={cellSize} height={cellSize} fill={CYAN} rx="0.5" />
        )
      }
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-lg">
      <rect width={size} height={size} fill="white" rx="4" />
      {cells}
    </svg>
  )
}

// ============ Main Component ============

export default function ReferralDashboardPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [timelineMode, setTimelineMode] = useState('daily')
  const [expandedNode, setExpandedNode] = useState(null)
  const [copiedLink, setCopiedLink] = useState(null)
  const [newSlug, setNewSlug] = useState('')

  // ============ Generate Deterministic Mock Data ============

  const referralTree = useMemo(() => {
    const rng = seededRandom(42_420)
    return generateReferralTree(rng)
  }, [])

  const earningsData = useMemo(() => {
    const rng = seededRandom(88_888)
    return {
      daily: generateEarningsData(rng, 'daily'),
      weekly: generateEarningsData(seededRandom(77_777), 'weekly'),
      monthly: generateEarningsData(seededRandom(66_666), 'monthly'),
    }
  }, [])

  const leaderboard = useMemo(() => {
    const rng = seededRandom(13_370)
    return generateLeaderboard(rng)
  }, [])

  const links = useMemo(() => {
    const rng = seededRandom(55_555)
    return generateLinks(rng)
  }, [])

  // ============ Computed Stats ============

  const totalReferrals = referralTree.length + referralTree.reduce((s, r) => s + r.depth2.length, 0)
  const activeReferrals = referralTree.filter((r) => r.isActive).length + referralTree.reduce((s, r) => s + r.depth2.filter((d) => d.isActive).length, 0)
  const totalEarnings = referralTree.reduce((s, r) => s + r.commission, 0) + referralTree.reduce((s, r) => s + r.depth2.reduce((ss, d) => ss + d.commission, 0), 0)
  const totalClicks = links.reduce((s, l) => s + l.clicks, 0)
  const totalConversions = links.reduce((s, l) => s + l.conversions, 0)
  const conversionRate = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) : '0.0'

  const currentTierIndex = TIERS.findIndex((t) => t.maxRefs === null || totalReferrals <= t.maxRefs)
  const currentTier = TIERS[currentTierIndex] || TIERS[0]
  const nextTier = TIERS[currentTierIndex + 1]
  const progressToNext = nextTier
    ? ((totalReferrals - currentTier.minRefs) / (nextTier.minRefs - currentTier.minRefs)) * 100
    : 100

  // ============ Handlers ============

  const handleCopyLink = (slug) => {
    navigator.clipboard?.writeText(`https://${slug}`)
    setCopiedLink(slug)
    setTimeout(() => setCopiedLink(null), 2000)
  }

  const handleShareTwitter = (slug) => {
    window.open(`https://twitter.com/intent/tweet?text=Trade on VibeSwap — zero MEV, fair prices.&url=https://${slug}`, '_blank')
  }

  const handleShareTelegram = (slug) => {
    window.open(`https://t.me/share/url?url=https://${slug}&text=Trade on VibeSwap — zero MEV, fair prices.`, '_blank')
  }

  // ============ Not Connected State ============

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard glowColor="warning" className="max-w-md mx-auto p-8 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            <div
              className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: `${AMBER}20`, border: `1px solid ${AMBER}40` }}
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={AMBER} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">
              Referral <span style={{ color: AMBER }}>Dashboard</span>
            </h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Sign in to view detailed referral analytics, track your network, and manage referral links.
            </p>
            <button
              onClick={connect}
              className="px-8 py-3 rounded-xl font-mono font-bold text-sm"
              style={{ background: AMBER, color: '#000', boxShadow: `0 0 20px ${AMBER}40` }}
            >
              Sign In
            </button>
          </motion.div>
        </GlassCard>
      </div>
    )
  }

  // ============ Connected View ============

  return (
    <div className="max-w-5xl mx-auto px-4 pb-12">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="knowledge"
        title="Referral Dashboard"
        subtitle="Track your referral network performance"
        badge="Analytics"
        badgeColor={AMBER}
      >
        <Link
          to="/referral"
          className="text-xs font-mono px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
        >
          Basic View
        </Link>
      </PageHero>

      <div className="space-y-10">

        {/* ============ Section 1: Stats Overview ============ */}
        <Section index={0} tag="Overview" title="Key Metrics">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Referrals', value: totalReferrals.toString(), color: AMBER, sub: `${referralTree.length} direct + ${totalReferrals - referralTree.length} depth-2`, icon: '👥' },
              { label: 'Active (30d)', value: activeReferrals.toString(), color: '#22c55e', sub: `${((activeReferrals / Math.max(totalReferrals, 1)) * 100).toFixed(0)}% retention`, icon: '⚡' },
              { label: 'Total Earnings', value: `${fmtJUL(totalEarnings)} JUL`, color: CYAN, sub: `~ ${fmtCurrency(totalEarnings * 1.24)}`, icon: '💎' },
              { label: 'Conversion Rate', value: `${conversionRate}%`, color: '#a855f7', sub: `${totalConversions} of ${totalClicks} clicks`, icon: '📊' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * (0.06 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
              >
                <GlassCard glowColor="warning" className="p-4" hover>
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-[10px] font-mono text-gray-500 uppercase">{stat.label}</div>
                    <span className="text-lg">{stat.icon}</span>
                  </div>
                  <div className="text-xl sm:text-2xl font-bold font-mono" style={{ color: stat.color }}>
                    {stat.value}
                  </div>
                  <div className="text-[10px] font-mono text-gray-600 mt-1">{stat.sub}</div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ Section 2: Referral Tree ============ */}
        <Section index={1} tag="Network" title="Referral Tree">
          <GlassCard glowColor="warning" className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Depth 1 (direct)
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
                <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> Depth 2 (indirect)
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Active
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
                <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" /> Inactive
              </div>
            </div>
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-gray-800/50 text-[10px] font-mono text-gray-500 uppercase">
              <div className="col-span-1"></div>
              <div className="col-span-3">Address</div>
              <div className="col-span-2">Joined</div>
              <div className="col-span-2 text-right">Volume</div>
              <div className="col-span-2 text-right">Commission</div>
              <div className="col-span-2 text-right">Status</div>
            </div>
            {/* Tree rows */}
            <div className="space-y-0.5 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
              {referralTree.map((node, i) => (
                <div key={node.address}>
                  {/* Depth 1 row */}
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * (0.03 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
                    className="grid grid-cols-12 gap-2 py-2.5 border-b border-gray-800/20 text-[11px] font-mono hover:bg-white/[0.02] rounded transition-colors cursor-pointer"
                    onClick={() => setExpandedNode(expandedNode === i ? null : i)}
                  >
                    <div className="col-span-1 flex items-center justify-center">
                      <motion.span
                        animate={{ rotate: expandedNode === i ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-gray-500 text-xs"
                      >
                        {node.depth2.length > 0 ? '▶' : '─'}
                      </motion.span>
                    </div>
                    <div className="col-span-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: AMBER }} />
                      <span className="text-gray-300 truncate">{shortenAddr(node.address)}</span>
                    </div>
                    <div className="col-span-2 text-gray-500 hidden sm:block">{node.joinDate}</div>
                    <div className="col-span-2 text-right text-gray-300 hidden sm:block">{fmtCurrency(node.volume)}</div>
                    <div className="col-span-2 text-right font-bold" style={{ color: '#22c55e' }}>+{fmtJUL(node.commission)}</div>
                    <div className="col-span-2 text-right">
                      <span
                        className="px-2 py-0.5 rounded-full text-[9px] font-mono"
                        style={{
                          background: node.isActive ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
                          color: node.isActive ? '#22c55e' : '#6b7280',
                          border: `1px solid ${node.isActive ? 'rgba(34,197,94,0.3)' : 'rgba(107,114,128,0.3)'}`,
                        }}
                      >
                        {node.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </motion.div>
                  {/* Depth 2 rows */}
                  {expandedNode === i && node.depth2.map((sub, j) => (
                    <motion.div
                      key={sub.address}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, delay: j * 0.05 }}
                      className="grid grid-cols-12 gap-2 py-2 border-b border-gray-800/10 text-[11px] font-mono hover:bg-white/[0.02] rounded transition-colors"
                      style={{ background: 'rgba(6,182,212,0.02)' }}
                    >
                      <div className="col-span-1 flex items-center justify-center text-gray-700">└</div>
                      <div className="col-span-3 flex items-center gap-2 pl-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CYAN }} />
                        <span className="text-gray-400 truncate">{shortenAddr(sub.address)}</span>
                      </div>
                      <div className="col-span-2 text-gray-600 hidden sm:block">{sub.joinDate}</div>
                      <div className="col-span-2 text-right text-gray-400 hidden sm:block">{fmtCurrency(sub.volume)}</div>
                      <div className="col-span-2 text-right text-cyan-400/80">+{fmtJUL(sub.commission)}</div>
                      <div className="col-span-2 text-right">
                        <span
                          className="px-2 py-0.5 rounded-full text-[9px] font-mono"
                          style={{
                            background: sub.isActive ? 'rgba(34,197,94,0.1)' : 'rgba(107,114,128,0.1)',
                            color: sub.isActive ? '#22c55e' : '#6b7280',
                          }}
                        >
                          {sub.isActive ? 'Active' : 'Idle'}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ))}
            </div>
            {/* Tree summary */}
            <div className="mt-3 pt-3 border-t border-gray-800/30 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-mono text-gray-500">
                {referralTree.length} direct referrals, {referralTree.reduce((s, r) => s + r.depth2.length, 0)} depth-2
              </span>
              <span className="text-[10px] font-mono" style={{ color: '#22c55e' }}>
                Total commission: {fmtJUL(totalEarnings)} JUL
              </span>
            </div>
          </GlassCard>
        </Section>

        {/* ============ Section 3: Earnings Timeline ============ */}
        <Section index={2} tag="Earnings" title="Earnings Timeline">
          <GlassCard glowColor="warning" className="p-5">
            {/* Toggle buttons */}
            <div className="flex items-center gap-2 mb-4">
              {['daily', 'weekly', 'monthly'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTimelineMode(mode)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider transition-all"
                  style={{
                    background: timelineMode === mode ? `${AMBER}20` : 'transparent',
                    color: timelineMode === mode ? AMBER : '#6b7280',
                    border: `1px solid ${timelineMode === mode ? `${AMBER}40` : 'rgba(55,65,81,0.3)'}`,
                  }}
                >
                  {mode}
                </button>
              ))}
              <div className="flex-1" />
              <div className="text-[10px] font-mono text-gray-500">
                Total: <span style={{ color: AMBER }} className="font-bold">
                  {fmtJUL(earningsData[timelineMode].reduce((s, d) => s + d.value, 0))} JUL
                </span>
              </div>
            </div>
            {/* Chart */}
            <div className="relative">
              <EarningsChart data={earningsData[timelineMode]} color={AMBER} />
            </div>
            {/* Summary row */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: 'Peak', value: fmtJUL(Math.max(...earningsData[timelineMode].map((d) => d.value))), color: AMBER },
                { label: 'Average', value: fmtJUL(earningsData[timelineMode].reduce((s, d) => s + d.value, 0) / earningsData[timelineMode].length), color: CYAN },
                { label: 'Trend', value: earningsData[timelineMode].length >= 2 && earningsData[timelineMode][earningsData[timelineMode].length - 1].value > earningsData[timelineMode][earningsData[timelineMode].length - 2].value ? '+Up' : '-Down', color: earningsData[timelineMode].length >= 2 && earningsData[timelineMode][earningsData[timelineMode].length - 1].value > earningsData[timelineMode][earningsData[timelineMode].length - 2].value ? '#22c55e' : '#ef4444' },
              ].map((item) => (
                <div key={item.label} className="text-center rounded-xl p-2 border border-gray-800/30" style={{ background: 'rgba(0,0,0,0.2)' }}>
                  <div className="text-[9px] font-mono text-gray-500 uppercase">{item.label}</div>
                  <div className="text-sm font-bold font-mono" style={{ color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </Section>

        {/* ============ Section 4: Referral Link Manager ============ */}
        <Section index={3} tag="Links" title="Referral Link Manager">
          <GlassCard glowColor="terminal" className="p-5">
            {/* Existing links */}
            <div className="space-y-3 mb-4">
              {links.map((link, i) => (
                <motion.div
                  key={link.slug}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 1 / PHI }}
                  className="rounded-xl p-4 border transition-all"
                  style={{
                    background: 'rgba(0,0,0,0.3)',
                    borderColor: link.isDefault ? `${AMBER}30` : 'rgba(55,65,81,0.3)',
                  }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm truncate" style={{ color: CYAN }}>{link.slug}</span>
                        {link.isDefault && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-mono uppercase" style={{ background: `${AMBER}20`, color: AMBER, border: `1px solid ${AMBER}30` }}>
                            Default
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-[10px] font-mono text-gray-500">
                        <span>{link.clicks} clicks</span>
                        <span>{link.conversions} conversions</span>
                        <span>{link.clicks > 0 ? ((link.conversions / link.clicks) * 100).toFixed(1) : '0.0'}% rate</span>
                        <span className="hidden sm:inline">Created {link.created}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleCopyLink(link.slug)}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-mono transition-colors"
                        style={{
                          background: copiedLink === link.slug ? 'rgba(34,197,94,0.2)' : `${CYAN}15`,
                          color: copiedLink === link.slug ? '#22c55e' : CYAN,
                          border: `1px solid ${copiedLink === link.slug ? 'rgba(34,197,94,0.3)' : `${CYAN}30`}`,
                        }}
                      >
                        {copiedLink === link.slug ? 'Copied!' : 'Copy'}
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleShareTwitter(link.slug)}
                        className="px-2 py-1.5 rounded-lg text-[10px] font-mono border border-gray-700/30 text-gray-400 hover:text-white hover:border-gray-600/50 transition-colors"
                      >
                        𝕏
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleShareTelegram(link.slug)}
                        className="px-2 py-1.5 rounded-lg text-[10px] font-mono border border-gray-700/30 text-gray-400 hover:text-cyan-400 hover:border-cyan-700/50 transition-colors"
                      >
                        TG
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
            {/* QR Code + New Link */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* QR Code */}
              <div className="rounded-xl p-4 border border-gray-800/30 text-center" style={{ background: 'rgba(0,0,0,0.2)' }}>
                <div className="text-[10px] font-mono text-gray-500 uppercase mb-3">QR Code (Default Link)</div>
                <div className="flex justify-center mb-3">
                  <SimpleQR value={links[0]?.slug || 'vibeswap'} size={140} />
                </div>
                <p className="text-[9px] font-mono text-gray-600">Scan to open your referral link</p>
              </div>
              {/* Generate new link */}
              <div className="rounded-xl p-4 border border-gray-800/30" style={{ background: 'rgba(0,0,0,0.2)' }}>
                <div className="text-[10px] font-mono text-gray-500 uppercase mb-3">Create Custom Link</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-mono text-gray-500 mb-1 block">Custom Slug</label>
                    <div className="flex items-center gap-0">
                      <span className="text-[11px] font-mono text-gray-600 px-3 py-2 rounded-l-lg border border-r-0 border-gray-700/40" style={{ background: 'rgba(0,0,0,0.3)' }}>
                        vibeswap.io/ref/
                      </span>
                      <input
                        type="text"
                        value={newSlug}
                        onChange={(e) => setNewSlug(e.target.value.replace(/[^a-z0-9-]/g, '').slice(0, 20))}
                        placeholder="my-link"
                        className="flex-1 text-[11px] font-mono px-3 py-2 rounded-r-lg border border-gray-700/40 bg-black/40 text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
                      />
                    </div>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={!newSlug}
                    className="w-full py-2.5 rounded-xl font-mono text-xs font-bold disabled:opacity-30 transition-all"
                    style={{
                      background: newSlug ? `${CYAN}20` : 'rgba(0,0,0,0.2)',
                      color: newSlug ? CYAN : '#6b7280',
                      border: `1px solid ${newSlug ? `${CYAN}40` : 'rgba(55,65,81,0.3)'}`,
                    }}
                  >
                    Generate Link
                  </motion.button>
                  <p className="text-[9px] font-mono text-gray-600 text-center">
                    Lowercase letters, numbers, and hyphens only
                  </p>
                </div>
              </div>
            </div>
          </GlassCard>
        </Section>

        {/* ============ Section 5: Tier System ============ */}
        <Section index={4} tag="Progression" title="Tier System">
          <GlassCard glowColor="warning" className="p-5">
            {/* Current tier banner */}
            <div
              className="rounded-xl p-4 mb-4 border text-center"
              style={{
                background: `linear-gradient(135deg, ${currentTier.color}08, ${currentTier.color}15)`,
                borderColor: `${currentTier.color}30`,
              }}
            >
              <div className="text-[10px] font-mono text-gray-500 uppercase mb-1">Current Tier</div>
              <div className="flex items-center justify-center gap-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-xl"
                  style={{ background: `${currentTier.color}20`, color: currentTier.color, border: `1px solid ${currentTier.color}40` }}
                >
                  {currentTier.icon}
                </div>
                <div>
                  <div className="text-xl font-bold font-mono" style={{ color: currentTier.color }}>{currentTier.name}</div>
                  <div className="text-[10px] font-mono text-gray-500">{currentTier.commission}% commission rate</div>
                </div>
              </div>
              {/* Progress to next */}
              {nextTier && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 mb-1">
                    <span>{totalReferrals} referrals</span>
                    <span>{nextTier.minRefs} needed for {nextTier.name}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${currentTier.color}, ${nextTier.color})` }}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${Math.min(progressToNext, 100)}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3, duration: 1, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 mt-1 text-center">
                    {nextTier.minRefs - totalReferrals} more referrals to <span style={{ color: nextTier.color }} className="font-bold">{nextTier.name}</span>
                  </div>
                </div>
              )}
              {!nextTier && (
                <div className="mt-3 text-[10px] font-mono text-gray-400">
                  Maximum tier reached. You are in the top tier.
                </div>
              )}
            </div>
            {/* All tiers comparison */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {TIERS.map((tier, i) => {
                const isActive = i === currentTierIndex
                const isLocked = i > currentTierIndex
                return (
                  <motion.div
                    key={tier.name}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * (0.06 / PHI), duration: 1 / PHI }}
                    className="rounded-xl p-4 border transition-all relative"
                    style={{
                      background: isActive ? `${tier.color}08` : 'rgba(0,0,0,0.2)',
                      borderColor: isActive ? `${tier.color}40` : 'rgba(55,65,81,0.3)',
                      opacity: isLocked ? 0.5 : 1,
                    }}
                  >
                    {isActive && (
                      <motion.div
                        className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[8px] font-mono font-bold"
                        style={{ background: tier.color, color: '#000' }}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      >
                        YOU
                      </motion.div>
                    )}
                    <div
                      className="w-8 h-8 mx-auto rounded-lg flex items-center justify-center font-mono font-bold text-sm mb-2"
                      style={{ background: `${tier.color}20`, color: tier.color, border: `1px solid ${tier.color}40` }}
                    >
                      {tier.icon}
                    </div>
                    <div className="text-center">
                      <div className="text-xs font-bold font-mono text-white">{tier.name}</div>
                      <div className="text-lg font-bold font-mono mt-0.5" style={{ color: tier.color }}>{tier.commission}%</div>
                      <div className="text-[9px] font-mono text-gray-500 mb-2">
                        {tier.maxRefs !== null ? `${tier.minRefs}-${tier.maxRefs} refs` : `${tier.minRefs}+ refs`}
                      </div>
                      {/* Benefits list */}
                      <div className="space-y-1">
                        {tier.benefits.map((b, bi) => (
                          <div key={bi} className="text-[9px] font-mono text-gray-500 flex items-center gap-1">
                            <span style={{ color: tier.color }}>+</span>
                            <span className="truncate">{b}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </GlassCard>
        </Section>

        {/* ============ Section 6: Leaderboard ============ */}
        <Section index={5} tag="Rankings" title="Top Referrers">
          <GlassCard glowColor="warning" className="p-5">
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-gray-800/50 text-[10px] font-mono text-gray-500 uppercase">
              <div className="col-span-1">Rank</div>
              <div className="col-span-3">Address</div>
              <div className="col-span-2 text-right">Referrals</div>
              <div className="col-span-3 text-right">Total Volume</div>
              <div className="col-span-3 text-right">Earnings (JUL)</div>
            </div>
            {/* Table rows */}
            <div className="space-y-0.5">
              {leaderboard.map((entry, i) => {
                const isYou = i === 4
                return (
                  <motion.div
                    key={entry.address}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * (0.04 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
                    className="grid grid-cols-12 gap-2 py-2.5 border-b border-gray-800/20 text-[11px] font-mono hover:bg-white/[0.02] rounded transition-colors items-center"
                    style={{
                      background: isYou ? `${AMBER}08` : 'transparent',
                      borderColor: isYou ? `${AMBER}15` : undefined,
                    }}
                  >
                    <div className="col-span-1">
                      <RankBadge rank={entry.rank} />
                    </div>
                    <div className="col-span-3 flex items-center gap-2">
                      <span className="text-gray-300 truncate">{shortenAddr(entry.address)}</span>
                      {isYou && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-mono" style={{ background: `${AMBER}20`, color: AMBER }}>
                          YOU
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 text-right text-gray-300">{entry.referrals}</div>
                    <div className="col-span-3 text-right text-gray-300">{fmtCurrency(entry.volume)}</div>
                    <div className="col-span-3 text-right font-bold" style={{ color: '#22c55e' }}>
                      {fmtJUL(entry.earnings)}
                    </div>
                  </motion.div>
                )
              })}
            </div>
            {/* Your position note */}
            <div className="mt-3 pt-3 border-t border-gray-800/30 text-center">
              <p className="text-[10px] font-mono text-gray-500">
                Your position: <span style={{ color: AMBER }} className="font-bold">#5</span> out of{' '}
                <span className="text-white font-bold">1,247</span> referrers
              </p>
            </div>
          </GlassCard>
        </Section>

        {/* ============ Quick Actions ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 1 / PHI }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          {[
            { label: 'Claim Rewards', href: '/referral', color: '#22c55e', borderColor: 'border-green-500/30' },
            { label: 'View Rewards', href: '/rewards', color: '#a855f7', borderColor: 'border-purple-500/30' },
            { label: 'Game Theory', href: '/game-theory', color: CYAN, borderColor: 'border-cyan-500/30' },
            { label: 'Economics', href: '/economics', color: AMBER, borderColor: 'border-amber-500/30' },
          ].map((action) => (
            <Link
              key={action.label}
              to={action.href}
              className={`text-center text-xs font-mono px-3 py-3 rounded-xl border ${action.borderColor} hover:bg-white/[0.03] transition-colors`}
              style={{ color: action.color }}
            >
              {action.label}
            </Link>
          ))}
        </motion.div>

        {/* ============ Footer Quote ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 1 / PHI }}
          className="text-center"
        >
          <p className="text-[10px] font-mono text-gray-500">
            "Attribution is structural — Shapley makes every referral a dependency in the value graph."
          </p>
        </motion.div>
      </div>
    </div>
  )
}
