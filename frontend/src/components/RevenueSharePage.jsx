import { useState, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
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
const rand = seededRandom(4242)

// ============ Distribution Splits ============
const DISTRIBUTION_SPLITS = [
  { label: 'JUL Stakers', pct: 40, color: '#06b6d4', icon: '\u25C8' },
  { label: 'Liquidity Providers', pct: 30, color: '#34d399', icon: '\u25C9' },
  { label: 'Treasury', pct: 20, color: '#a78bfa', icon: '\u2B23' },
  { label: 'Buyback & Burn', pct: 10, color: '#f59e0b', icon: '\u2666' },
]

// ============ Fee Sources ============
const FEE_SOURCES = [
  { label: 'Swap Fees', daily: 12_840, pct: 52, color: CYAN },
  { label: 'Bridge Fees', daily: 5_910, pct: 24, color: '#34d399' },
  { label: 'Liquidation Fees', daily: 3_690, pct: 15, color: '#f59e0b' },
  { label: 'Priority Bids', daily: 2_214, pct: 9, color: '#a78bfa' },
]

// ============ Protocol Revenue Stats ============
const REVENUE_STATS = {
  daily: 24_654, weekly: 172_578, monthly: 739_620, allTime: 8_427_310, julPrice: 0.87,
}

// ============ Your Earnings (Mock) ============
const YOUR_EARNINGS = {
  totalEarned: 3_847.52, pendingClaim: 412.38,
  epochHistory: [
    { epoch: 1847, amount: 84.21, date: Date.now() - 0 * 86400000 },
    { epoch: 1846, amount: 79.63, date: Date.now() - 1 * 86400000 },
    { epoch: 1845, amount: 91.07, date: Date.now() - 2 * 86400000 },
    { epoch: 1844, amount: 82.45, date: Date.now() - 3 * 86400000 },
    { epoch: 1843, amount: 75.02, date: Date.now() - 4 * 86400000 },
  ],
}

// ============ Distribution History (8 Epochs) ============
const DISTRIBUTION_HISTORY = (() => {
  const base = 1847
  return Array.from({ length: 8 }, (_, i) => {
    const total = 20_000 + Math.floor(rand() * 10_000)
    return {
      epoch: base - i, date: Date.now() - i * 86400000, totalDistributed: total,
      perStakerShare: total * 0.40 / 8_200, perLpShare: total * 0.30 / 5_400,
      treasuryAllocation: total * 0.20, buybackBurn: total * 0.10,
    }
  })
})()

// ============ Utility Functions ============
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}
function fmtUsd(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}
function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ============ Section Wrapper ============
function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span><span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Main Component ============
export default function RevenueSharePage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [claimProcessing, setClaimProcessing] = useState(false)
  const [calcStaked, setCalcStaked] = useState('10000')
  const [activeTab, setActiveTab] = useState('staker')
  const [historyPage, setHistoryPage] = useState(0)
  const HISTORY_PAGE_SIZE = 4

  // ============ Revenue Projections Calculator ============
  const projections = useMemo(() => {
    const staked = parseFloat(calcStaked) || 0
    const totalStaked = 8_427_310
    const shareOfPool = totalStaked > 0 ? staked / totalStaked : 0
    const stakerPoolDaily = REVENUE_STATS.daily * 0.40
    const dailyJul = stakerPoolDaily * shareOfPool
    const monthlyJul = dailyJul * 30
    const yearlyJul = dailyJul * 365
    const apr = totalStaked > 0 ? ((REVENUE_STATS.daily * 365 * 0.40) / totalStaked) * 100 : 0
    return {
      dailyJul, monthlyJul, yearlyJul,
      dailyUsd: dailyJul * REVENUE_STATS.julPrice,
      monthlyUsd: monthlyJul * REVENUE_STATS.julPrice,
      yearlyUsd: yearlyJul * REVENUE_STATS.julPrice,
      shareOfPool, apr,
    }
  }, [calcStaked])

  // ============ History Pagination ============
  const pagedHistory = useMemo(() => {
    const start = historyPage * HISTORY_PAGE_SIZE
    return DISTRIBUTION_HISTORY.slice(start, start + HISTORY_PAGE_SIZE)
  }, [historyPage])
  const totalHistoryPages = Math.ceil(DISTRIBUTION_HISTORY.length / HISTORY_PAGE_SIZE)

  const handleClaim = useCallback(() => {
    setClaimProcessing(true)
    setTimeout(() => setClaimProcessing(false), 2000)
  }, [])

  // ============ Not Connected ============
  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <PageHero title="Revenue Share" subtitle="Protocol fees flow back to the community — cooperative capitalism in action" category="defi" />
        <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center mt-8">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40` }}>
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">
              Connect to View <span style={{ color: CYAN }}>Revenue</span>
            </h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Stake JUL or provide liquidity to earn your share of protocol revenue. Every fee collected flows back to the community.
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
      <PageHero title="Revenue Share" subtitle="Protocol fees flow back to the community — cooperative capitalism in action"
        category="defi" badge="Live" badgeColor="#22c55e" />

      {/* ============ 01. Revenue Flow Diagram ============ */}
      <Section num="01" title="Revenue Flow" delay={0.05}>
        <GlassCard glowColor="terminal" className="p-6">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-4">
            {/* Source */}
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.08, type: 'spring', stiffness: 300, damping: 20 }}
              className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold mb-1.5"
                style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30`, color: CYAN }}>$</div>
              <div className="text-xs font-mono font-bold text-white">Fee Collection</div>
            </motion.div>
            {/* Arrow */}
            <motion.div initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: 0.14 }}
              className="text-gray-600 text-xl font-mono hidden sm:block">\u2192</motion.div>
            {/* Treasury */}
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.20, type: 'spring', stiffness: 300, damping: 20 }}
              className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold mb-1.5"
                style={{ background: '#a78bfa15', border: '1px solid #a78bfa30', color: '#a78bfa' }}>{'\u2B23'}</div>
              <div className="text-xs font-mono font-bold text-white">Treasury</div>
            </motion.div>
            <motion.div initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: 0.26 }}
              className="text-gray-600 text-xl font-mono hidden sm:block">\u2192</motion.div>
            {/* Distribution */}
            <div className="flex flex-col items-center">
              <div className="text-xs font-mono text-gray-400 mb-2">Distribution</div>
              <div className="grid grid-cols-2 gap-2">
                {DISTRIBUTION_SPLITS.map((split, i) => (
                  <motion.div key={split.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.30 + i * (0.06 / PHI) }}
                    className="flex items-center gap-2 p-2 rounded-lg" style={{ background: `${split.color}08` }}>
                    <span className="text-sm" style={{ color: split.color }}>{split.icon}</span>
                    <div>
                      <div className="text-[10px] font-mono font-bold text-white">{split.label}</div>
                      <div className="text-[10px] font-mono" style={{ color: split.color }}>{split.pct}%</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
          {/* Distribution bars */}
          <div className="flex gap-1 h-4 rounded-full overflow-hidden">
            {DISTRIBUTION_SPLITS.map((split, i) => (
              <motion.div key={split.label} className="h-full relative" style={{ background: split.color }}
                initial={{ width: 0 }} animate={{ width: `${split.pct}%` }}
                transition={{ duration: PHI, delay: 0.35 + i * 0.08, ease: 'easeOut' }}>
                <motion.div className="absolute inset-0"
                  style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)' }}
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 3, repeat: Infinity, repeatDelay: 5, ease: 'easeInOut' }} />
              </motion.div>
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            {DISTRIBUTION_SPLITS.map(s => (
              <div key={s.label} className="text-[9px] font-mono" style={{ color: s.color }}>{s.pct}%</div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 02. Your Earnings ============ */}
      <Section num="02" title="Your Earnings" delay={0.12}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {[
            { label: 'Total Earned', value: `${fmt(YOUR_EARNINGS.totalEarned)} JUL`, usd: fmtUsd(YOUR_EARNINGS.totalEarned * REVENUE_STATS.julPrice), color: '#34d399' },
            { label: 'Pending Claim', value: `${fmt(YOUR_EARNINGS.pendingClaim)} JUL`, usd: fmtUsd(YOUR_EARNINGS.pendingClaim * REVENUE_STATS.julPrice), color: CYAN },
            { label: 'Current Epoch', value: `#${YOUR_EARNINGS.epochHistory[0].epoch}`, usd: `+${YOUR_EARNINGS.epochHistory[0].amount.toFixed(2)} JUL`, color: '#a78bfa' },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 + i * (0.06 / PHI) }}>
              <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                <div className="text-xl sm:text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{s.label}</div>
                <div className="text-[9px] font-mono text-gray-600 mt-0.5">{s.usd}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
        <GlassCard glowColor="terminal" className="p-4">
          <div className="text-xs font-mono text-gray-400 mb-3">Last 5 Epochs</div>
          <div className="space-y-2">
            {YOUR_EARNINGS.epochHistory.map((ep, i) => (
              <motion.div key={ep.epoch} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.18 + i * 0.04 }}
                className="flex items-center justify-between p-2.5 rounded-lg border"
                style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold"
                    style={{ background: `${CYAN}15`, color: CYAN }}>#{ep.epoch}</div>
                  <div className="text-xs font-mono text-gray-500">{fmtShortDate(ep.date)}</div>
                </div>
                <div className="font-mono text-sm font-bold" style={{ color: '#34d399' }}>+{ep.amount.toFixed(2)} JUL</div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 03. Protocol Revenue Stats ============ */}
      <Section num="03" title="Protocol Revenue" delay={0.20}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {[
            { label: 'Daily Revenue', value: fmt(REVENUE_STATS.daily), sub: fmtUsd(REVENUE_STATS.daily * REVENUE_STATS.julPrice) },
            { label: 'Weekly Revenue', value: fmt(REVENUE_STATS.weekly), sub: fmtUsd(REVENUE_STATS.weekly * REVENUE_STATS.julPrice) },
            { label: 'Monthly Revenue', value: fmt(REVENUE_STATS.monthly), sub: fmtUsd(REVENUE_STATS.monthly * REVENUE_STATS.julPrice) },
            { label: 'All-Time Revenue', value: fmt(REVENUE_STATS.allTime), sub: fmtUsd(REVENUE_STATS.allTime * REVENUE_STATS.julPrice), color: '#34d399' },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 + i * (0.05 / PHI) }}>
              <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                <div className="text-lg sm:text-xl font-bold font-mono" style={{ color: s.color || CYAN }}>
                  {s.value} <span className="text-xs text-gray-500">JUL</span>
                </div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{s.label}</div>
                <div className="text-[9px] font-mono text-gray-600 mt-0.5">{s.sub}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
        {/* Fee Sources Breakdown */}
        <GlassCard glowColor="terminal" className="p-5">
          <div className="text-xs font-mono text-gray-400 mb-4">Fee Sources (Daily)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {FEE_SOURCES.map((source, i) => (
              <motion.div key={source.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.26 + i * 0.05 }}
                className="p-3 rounded-xl border text-center"
                style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                <div className="font-mono text-base font-bold" style={{ color: source.color }}>{fmt(source.daily)}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{source.label}</div>
                <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: '#1f2937' }}>
                  <motion.div className="h-full rounded-full" style={{ background: source.color }}
                    initial={{ width: 0 }} animate={{ width: `${source.pct}%` }}
                    transition={{ duration: 0.8 * PHI, delay: 0.30 + i * 0.08 }} />
                </div>
                <div className="text-[9px] font-mono text-gray-600 mt-1">{source.pct}% of total</div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 04. Distribution History ============ */}
      <Section num="04" title="Distribution History" delay={0.28}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-6 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Epoch</div><div>Date</div><div>Total Distributed</div>
            <div>Per-Staker</div><div>Per-LP</div><div className="text-right">Treasury</div>
          </div>
          {pagedHistory.map((row, i) => (
            <motion.div key={row.epoch} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.30 + i * 0.04 }}
              className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-5 py-3 border-b border-gray-800/50 items-center hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: CYAN }} />
                <span className="font-mono text-sm font-bold" style={{ color: CYAN }}>#{row.epoch}</span>
              </div>
              <div className="font-mono text-xs text-gray-500">{fmtShortDate(row.date)}</div>
              <div className="font-mono text-sm text-white font-bold">{fmt(row.totalDistributed)} JUL</div>
              <div className="font-mono text-sm" style={{ color: CYAN }}>{row.perStakerShare.toFixed(2)} JUL</div>
              <div className="font-mono text-sm" style={{ color: '#34d399' }}>{row.perLpShare.toFixed(2)} JUL</div>
              <div className="font-mono text-sm text-right" style={{ color: '#a78bfa' }}>{fmt(row.treasuryAllocation)} JUL</div>
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

      {/* ============ 05. Claim Rewards ============ */}
      <Section num="05" title="Claim Rewards" delay={0.34}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
            <div>
              <div className="font-mono text-xs text-gray-400 mb-1">Available to Claim</div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-mono font-bold" style={{ color: '#34d399' }}>{fmt(YOUR_EARNINGS.pendingClaim)}</span>
                <span className="text-sm font-mono text-gray-500">JUL</span>
              </div>
              <div className="text-[10px] font-mono text-gray-600 mt-1">
                ~{fmtUsd(YOUR_EARNINGS.pendingClaim * REVENUE_STATS.julPrice)} at current price
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={handleClaim} disabled={claimProcessing}
                className="px-8 py-3 rounded-xl font-mono font-bold text-sm disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000', boxShadow: `0 0 20px ${CYAN}30` }}>
                {claimProcessing ? 'Claiming...' : 'Claim All'}
              </motion.button>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-600">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Est. gas: ~0.0008 ETH ({fmtUsd(0.0008 * 3200)})</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'From Swaps', amount: YOUR_EARNINGS.pendingClaim * 0.52, pct: 52, color: CYAN },
              { label: 'From Bridges', amount: YOUR_EARNINGS.pendingClaim * 0.24, pct: 24, color: '#34d399' },
              { label: 'From Liquidations', amount: YOUR_EARNINGS.pendingClaim * 0.15, pct: 15, color: '#f59e0b' },
              { label: 'From Priority', amount: YOUR_EARNINGS.pendingClaim * 0.09, pct: 9, color: '#a78bfa' },
            ].map((source, i) => (
              <div key={source.label} className="p-3 rounded-xl border text-center"
                style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                <div className="font-mono text-sm font-bold" style={{ color: source.color }}>{source.amount.toFixed(2)}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-0.5">{source.label}</div>
                <div className="h-1 rounded-full overflow-hidden mt-2" style={{ background: '#1f2937' }}>
                  <motion.div className="h-full rounded-full" style={{ background: source.color }}
                    initial={{ width: 0 }} animate={{ width: `${source.pct}%` }}
                    transition={{ duration: 0.8, delay: i * 0.1 }} />
                </div>
                <div className="text-[9px] font-mono text-gray-600 mt-1">{source.pct}%</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 06. Revenue Projections Calculator ============ */}
      <Section num="06" title="Revenue Projections" delay={0.40}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center gap-2 mb-5">
            {[
              { key: 'staker', label: 'JUL Staker', color: CYAN },
              { key: 'lp', label: 'LP Provider', color: '#34d399' },
            ].map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 rounded-lg text-xs font-mono font-bold transition-all"
                style={{
                  background: activeTab === tab.key ? `${tab.color}20` : 'transparent',
                  color: activeTab === tab.key ? tab.color : '#6b7280',
                  border: `1px solid ${activeTab === tab.key ? `${tab.color}40` : 'transparent'}`,
                }}>{tab.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
            <div>
              <label className="text-xs font-mono text-gray-400 mb-1.5 block">
                {activeTab === 'staker' ? 'JUL Staked' : 'LP Value (JUL equivalent)'}
              </label>
              <div className="relative">
                <input type="number" value={calcStaked} onChange={(e) => setCalcStaked(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-black/40 border rounded-xl px-4 py-3 pr-16 text-white font-mono text-lg placeholder-gray-600 focus:outline-none"
                  style={{ borderColor: `${CYAN}40` }} />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button onClick={() => setCalcStaked('50000')}
                    className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold"
                    style={{ background: `${CYAN}20`, color: CYAN }}>50K</button>
                  <span className="text-xs font-mono text-gray-500">JUL</span>
                </div>
              </div>
              <div className="text-[10px] font-mono text-gray-600 mt-1.5">
                Total staked: {fmt(8_427_310)} JUL | Your share: {(projections.shareOfPool * 100).toFixed(4)}%
              </div>
            </div>
            <div>
              <label className="text-xs font-mono text-gray-400 mb-1.5 block">Current Revenue APR</label>
              <div className="w-full rounded-xl px-4 py-3 font-mono text-lg font-bold flex items-center gap-2"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid #1f2937' }}>
                <span style={{ color: activeTab === 'staker' ? CYAN : '#34d399' }}>
                  {activeTab === 'staker' ? projections.apr.toFixed(2) : (projections.apr * 0.75).toFixed(2)}%
                </span>
                <span className="text-xs text-gray-500 font-normal">from protocol fees alone</span>
              </div>
              <div className="text-[10px] font-mono text-gray-600 mt-1.5">
                {activeTab === 'staker' ? '40% of daily revenue distributed to stakers' : '30% of daily revenue distributed to LPs'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Daily', jul: activeTab === 'staker' ? projections.dailyJul : projections.dailyJul * 0.75,
                usd: activeTab === 'staker' ? projections.dailyUsd : projections.dailyUsd * 0.75 },
              { label: 'Monthly', jul: activeTab === 'staker' ? projections.monthlyJul : projections.monthlyJul * 0.75,
                usd: activeTab === 'staker' ? projections.monthlyUsd : projections.monthlyUsd * 0.75 },
              { label: 'Yearly', jul: activeTab === 'staker' ? projections.yearlyJul : projections.yearlyJul * 0.75,
                usd: activeTab === 'staker' ? projections.yearlyUsd : projections.yearlyUsd * 0.75 },
            ].map((p) => (
              <div key={p.label} className="p-4 rounded-xl text-center border"
                style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                <div className="text-lg sm:text-xl font-mono font-bold"
                  style={{ color: activeTab === 'staker' ? CYAN : '#34d399' }}>
                  +{p.jul >= 1000 ? fmt(p.jul) : p.jul.toFixed(2)}
                </div>
                <div className="text-[10px] font-mono text-gray-500 mt-0.5">JUL</div>
                <div className="text-[10px] font-mono text-gray-600 mt-1">{fmtUsd(p.usd)}</div>
                <div className="text-[10px] font-mono text-gray-600">{p.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.15)', borderColor: '#1f2937' }}>
            <div className="text-[10px] font-mono text-gray-500 leading-relaxed text-center">
              Projections based on current daily protocol revenue of {fmt(REVENUE_STATS.daily)} JUL
              and total staked supply of {fmt(8_427_310)} JUL. Actual earnings vary with protocol volume.
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 07. How It Works ============ */}
      <Section num="07" title="How It Works" delay={0.46}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { title: 'Batch Settlement', desc: 'Revenue collected per 10-second batch cycle. Commit-reveal ensures MEV-free fees.', icon: '\u25C6' },
              { title: 'Epoch Distribution', desc: 'Accumulated fees distributed every epoch (~24h). Shapley values weight contributions.', icon: '\u25C7' },
              { title: 'Cooperative Model', desc: '100% of revenue flows to stakers, LPs, treasury, and buyback. Zero team allocation.', icon: '\u25CB' },
              { title: 'Auto-Compound', desc: 'Restake revenue share automatically. Compound interest accelerates your returns.', icon: '\u25CE' },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.48 + i * 0.06 }}
                className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                <div className="text-lg mb-1" style={{ color: CYAN }}>{item.icon}</div>
                <div className="text-xs font-mono font-bold text-white mb-1">{item.title}</div>
                <div className="text-[10px] font-mono text-gray-500 leading-relaxed">{item.desc}</div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ Footer ============ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.54 }} className="text-center pb-4">
        <p className="text-[10px] font-mono text-gray-600 leading-relaxed max-w-xl mx-auto">
          Revenue share is non-custodial and distributed on-chain. All percentages are governed by DAO vote.
          Historical returns are not indicative of future performance. Protocol revenue depends on trading volume.
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-2 text-[10px] text-gray-700">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>Cooperative capitalism secured by VibeSwap circuit breakers</span>
        </div>
      </motion.div>

      <div style={{ height: PHI * 24 }} />
    </div>
  )
}
