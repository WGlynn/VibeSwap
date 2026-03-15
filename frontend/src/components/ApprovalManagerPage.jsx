import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}

// ============ Seeded PRNG (seed 2525) ============

function createPRNG(seed) {
  let s = seed
  return function next() {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

// ============ Risk Helpers ============

const RISK_LEVELS = {
  high: { label: 'High', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' },
  medium: { label: 'Medium', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
  low: { label: 'Low', color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)' },
}

function getRiskLevel(amount, isUnlimited) {
  if (isUnlimited) return 'high'
  if (amount > 50000) return 'medium'
  return 'low'
}

// ============ Mock Data ============

const TOKEN_NAMES = ['USDC', 'WETH', 'USDT', 'DAI', 'WBTC', 'LINK', 'UNI', 'AAVE', 'ARB', 'OP']
const TOKEN_SYMBOLS = { USDC: '$', WETH: 'E', USDT: '$', DAI: '$', WBTC: 'B', LINK: 'L', UNI: 'U', AAVE: 'A', ARB: 'a', OP: 'O' }
const TOKEN_PRICES = { USDC: 1, WETH: 3245.80, USDT: 1, DAI: 1, WBTC: 67420, LINK: 14.52, UNI: 7.89, AAVE: 92.30, ARB: 1.12, OP: 2.34 }
const TOKEN_COLORS = {
  USDC: '#2775ca', WETH: '#627eea', USDT: '#26a17b', DAI: '#f5ac37',
  WBTC: '#f09242', LINK: '#2a5ada', UNI: '#ff007a', AAVE: '#b6509e',
  ARB: '#28a0f0', OP: '#ff0420',
}
const SPENDER_CONTRACTS = [
  { name: 'Uniswap V3 Router', address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', trusted: true },
  { name: 'VibeSwapCore', address: '0x7a3B4f2E91c8D6aB3e5F1c9D8a3B4f2E91c8D6a', trusted: true },
  { name: 'Aave V3 Pool', address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', trusted: true },
  { name: 'Unknown Contract', address: '0xdEaD000000000000000000000000000000001337', trusted: false },
  { name: '1inch Router V5', address: '0x1111111254EEB25477B68fb85Ed929f73A960582', trusted: true },
  { name: 'Curve Finance', address: '0x99a58482BD75cbab83b27EC03CA68fF489b5788f', trusted: true },
  { name: 'Suspicious DEX', address: '0xBaD0000000000000000000000000000000000BAD', trusted: false },
  { name: 'Compound V3', address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3', trusted: true },
]

function generateApprovals() {
  const approvals = []
  const r = createPRNG(2525)
  for (let i = 0; i < 12; i++) {
    const tokenIdx = Math.floor(r() * TOKEN_NAMES.length)
    const spenderIdx = Math.floor(r() * SPENDER_CONTRACTS.length)
    const isUnlimited = r() > 0.55
    const rawAmount = isUnlimited ? Infinity : Math.floor(r() * 200000) + 100
    const token = TOKEN_NAMES[tokenIdx]
    const spender = SPENDER_CONTRACTS[spenderIdx]
    const daysAgo = Math.floor(r() * 365) + 1
    approvals.push({
      id: `approval-${i}`, token, tokenColor: TOKEN_COLORS[token],
      spender: spender.name, spenderAddress: spender.address, trusted: spender.trusted,
      amount: rawAmount, isUnlimited, risk: getRiskLevel(rawAmount, isUnlimited),
      usdValue: isUnlimited ? null : rawAmount * TOKEN_PRICES[token],
      approvedAt: new Date(Date.now() - daysAgo * 86400000), daysAgo,
    })
  }
  return approvals
}

function generateHistory() {
  const events = []
  const r = createPRNG(2525 + 777)
  const actions = ['Approved', 'Revoked', 'Approved', 'Increased', 'Approved', 'Revoked']
  for (let i = 0; i < 8; i++) {
    const tokenIdx = Math.floor(r() * TOKEN_NAMES.length)
    const spenderIdx = Math.floor(r() * SPENDER_CONTRACTS.length)
    const actionIdx = Math.floor(r() * actions.length)
    const daysAgo = Math.floor(r() * 90) + 1
    events.push({
      id: `history-${i}`, action: actions[actionIdx], token: TOKEN_NAMES[tokenIdx],
      spender: SPENDER_CONTRACTS[spenderIdx].name, daysAgo,
      timestamp: new Date(Date.now() - daysAgo * 86400000),
      txHash: `0x${Array.from({ length: 8 }, () => Math.floor(r() * 16).toString(16)).join('')}...`,
    })
  }
  return events.sort((a, b) => a.daysAgo - b.daysAgo)
}

// ============ Best Practices ============

const BEST_PRACTICES = [
  { title: 'Never approve unlimited amounts', priority: 'critical',
    desc: 'Set exact amounts you intend to swap. Unlimited approvals leave your entire token balance exposed if the contract is compromised.' },
  { title: 'Revoke approvals after use', priority: 'critical',
    desc: 'Once a swap or deposit is complete, revoke the approval immediately. Unused approvals are dormant attack vectors.' },
  { title: 'Audit spender contracts', priority: 'high',
    desc: 'Only approve tokens to verified, audited contracts. Unknown or unverified spenders are the highest risk category.' },
  { title: 'Check approvals regularly', priority: 'high',
    desc: 'Review your active approvals at least monthly. Old approvals to deprecated contracts are easy targets for exploits.' },
  { title: 'Use separate wallets', priority: 'medium',
    desc: 'Keep high-value holdings in a wallet with zero approvals. Use a separate hot wallet for daily DeFi interactions.' },
  { title: 'Monitor contract upgrades', priority: 'medium',
    desc: 'Proxy contracts can change their implementation. An approval to a trusted contract today may point to malicious code tomorrow.' },
]

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Approval Row ============

function ApprovalRow({ approval, index, isSelected, onToggle, onRevoke, isRevoking }) {
  const riskStyle = RISK_LEVELS[approval.risk]
  const displayAmount = approval.isUnlimited ? 'Unlimited' : approval.amount.toLocaleString()

  return (
    <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.08 + index * (0.06 * PHI), duration: 0.4, ease }}
      className="rounded-xl p-3 md:p-4" style={{
        background: isSelected ? 'rgba(6,182,212,0.04)' : 'rgba(0,0,0,0.3)',
        border: `1px solid ${isSelected ? 'rgba(6,182,212,0.2)' : riskStyle.border}`,
      }}>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Checkbox */}
        <button onClick={() => onToggle(approval.id)}
          className="flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors"
          style={{ borderColor: isSelected ? CYAN : 'rgba(255,255,255,0.15)', background: isSelected ? `${CYAN}20` : 'transparent' }}>
          {isSelected && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-[10px] font-bold" style={{ color: CYAN }}>+</motion.span>
          )}
        </button>
        {/* Token icon */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-xs"
          style={{ background: `${approval.tokenColor}20`, border: `1.5px solid ${approval.tokenColor}40`, color: approval.tokenColor }}>
          {TOKEN_SYMBOLS[approval.token] || approval.token[0]}
        </div>
        {/* Token + Spender info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold text-white">{approval.token}</span>
            <span className="text-[9px] font-mono text-black-500">to</span>
            <span className="text-[10px] font-mono text-black-300 truncate">{approval.spender}</span>
            {!approval.trusted && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex-shrink-0">unverified</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] font-mono text-black-500">{approval.spenderAddress.slice(0, 10)}...{approval.spenderAddress.slice(-6)}</span>
            <span className="text-[9px] font-mono text-black-600">{approval.daysAgo}d ago</span>
          </div>
        </div>
        {/* Amount */}
        <div className="text-right flex-shrink-0">
          <div className="text-[11px] font-mono font-bold" style={{ color: approval.isUnlimited ? '#ef4444' : 'white' }}>{displayAmount}</div>
          {approval.usdValue && (
            <div className="text-[9px] font-mono text-black-500">~${approval.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          )}
        </div>
        {/* Risk Badge */}
        <div className="flex-shrink-0 text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: riskStyle.bg, border: `1px solid ${riskStyle.border}`, color: riskStyle.color }}>
          {riskStyle.label}
        </div>
        {/* Revoke Button */}
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => onRevoke(approval.id)} disabled={isRevoking}
          className="flex-shrink-0 text-[10px] font-mono font-bold px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: isRevoking ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)', color: isRevoking ? '#ef444480' : '#ef4444' }}>
          {isRevoking ? 'Revoking...' : 'Revoke'}
        </motion.button>
      </div>
    </motion.div>
  )
}

// ============ History Event ============

function HistoryEvent({ event, index }) {
  const actionColors = { Approved: '#f59e0b', Revoked: '#22c55e', Increased: '#ef4444' }
  const color = actionColors[event.action] || '#6b7280'

  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 + index * (0.07 * PHI), duration: 0.4, ease }}
      className="flex items-start gap-3 pl-1">
      <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 z-10"
        style={{ background: `${color}15`, border: `1.5px solid ${color}50` }}>
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
      <div className="flex-1 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${color}15` }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ background: `${color}10`, border: `1px solid ${color}25`, color }}>{event.action}</span>
            <span className="text-[11px] font-mono font-bold text-white">{event.token}</span>
          </div>
          <span className="text-[9px] font-mono text-black-500">{event.daysAgo}d ago</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-black-400">{event.spender}</span>
          <span className="text-[9px] font-mono text-black-600">{event.txHash}</span>
        </div>
      </div>
    </motion.div>
  )
}

// ============ Main Component ============

export default function ApprovalManagerPage() {
  // ============ Dual Wallet Detection ============
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ============ State ============
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [revokedIds, setRevokedIds] = useState(new Set())
  const [revokingIds, setRevokingIds] = useState(new Set())
  const [filterRisk, setFilterRisk] = useState('all')

  // ============ Data ============
  // Real approval data when connected (empty until on-chain scanner built), mock for demo
  const allApprovals = useMemo(() => isConnected ? [] : generateApprovals(), [isConnected])
  const historyEvents = useMemo(() => isConnected ? [] : generateHistory(), [isConnected])
  const activeApprovals = useMemo(() => allApprovals.filter((a) => !revokedIds.has(a.id)), [allApprovals, revokedIds])
  const filteredApprovals = useMemo(
    () => filterRisk === 'all' ? activeApprovals : activeApprovals.filter((a) => a.risk === filterRisk),
    [activeApprovals, filterRisk]
  )

  // ============ Stats ============
  const totalAtRisk = useMemo(() => activeApprovals.reduce((sum, a) => {
    if (a.isUnlimited) return sum + 100000 * TOKEN_PRICES[a.token]
    return sum + (a.usdValue || 0)
  }, 0), [activeApprovals])

  const highRiskCount = activeApprovals.filter((a) => a.risk === 'high').length
  const unlimitedCount = activeApprovals.filter((a) => a.isUnlimited).length
  const untrustedCount = activeApprovals.filter((a) => !a.trusted).length

  // ============ Handlers ============
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }, [])

  const selectAll = useCallback(() => {
    if (selectedIds.size === filteredApprovals.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filteredApprovals.map((a) => a.id)))
  }, [filteredApprovals, selectedIds.size])

  const revokeOne = useCallback((id) => {
    setRevokingIds((prev) => new Set(prev).add(id))
    setTimeout(() => {
      setRevokingIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      setRevokedIds((prev) => new Set(prev).add(id))
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
    }, 1200 * PHI)
  }, [])

  const batchRevoke = useCallback(() => {
    if (selectedIds.size === 0) return
    Array.from(selectedIds).forEach((id, i) => { setTimeout(() => revokeOne(id), i * (400 / PHI)) })
  }, [selectedIds, revokeOne])

  const fmtUsd = (v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v.toLocaleString(undefined, { maximumFractionDigits: 0 })

  // ============ Render ============
  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 29) % 100}%` }}
            animate={{ opacity: [0, 0.2, 0], scale: [0, 1.5, 0], y: [0, -40 - (i % 3) * 15] }}
            transition={{ duration: 3.5 + (i % 3) * 1.4, repeat: Infinity, delay: (i * 0.9) % 4.5, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-2">
        {/* ============ Page Hero ============ */}
        <PageHero title="Approval Manager" category="system"
          subtitle="Review and revoke ERC-20 token approvals to protect your assets"
          badge={`${activeApprovals.length} Active`} badgeColor={highRiskCount > 0 ? '#ef4444' : '#22c55e'} />

        {/* ============ Security Warning Banner ============ */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease }} className="mb-6 rounded-xl p-4"
          style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(245,158,11,0.04) 100%)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>!</div>
            <div>
              <h3 className="text-[12px] font-mono font-bold text-white mb-1">Unlimited Approvals Are Dangerous</h3>
              <p className="text-[10px] font-mono text-black-400 leading-relaxed">
                When you approve a contract for <span style={{ color: '#ef4444' }}>unlimited tokens</span>, you grant it
                permission to spend your <span className="text-white">entire balance</span> at any time. If that contract
                is exploited, hacked, or has a hidden backdoor, your tokens can be drained in a single transaction.
                Always approve only the exact amount needed and revoke immediately after use.
              </p>
              {unlimitedCount > 0 && (
                <p className="text-[10px] font-mono mt-2" style={{ color: '#ef4444' }}>
                  You currently have {unlimitedCount} unlimited approval{unlimitedCount > 1 ? 's' : ''} active.
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* ============ Summary Stats ============ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total At Risk', value: `$${fmtUsd(totalAtRisk)}`, color: '#ef4444' },
            { label: 'High Risk', value: highRiskCount, color: '#ef4444' },
            { label: 'Unlimited', value: unlimitedCount, color: '#f59e0b' },
            { label: 'Unverified Spenders', value: untrustedCount, color: '#f59e0b' },
          ].map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * (0.06 * PHI), duration: 0.4, ease }}>
              <GlassCard glowColor="none" hover className="p-3">
                <div className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1">{stat.label}</div>
                <div className="text-lg font-mono font-bold" style={{ color: stat.color }}>{stat.value}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>

        {!isConnected && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}
            className="mb-6 rounded-xl p-6 text-center"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[11px] font-mono text-black-400 mb-1">Connect your wallet to view live approvals</p>
            <p className="text-[10px] font-mono text-black-600">Showing demo data below</p>
          </motion.div>
        )}

        <div className="space-y-6">
          {/* ============ 1. Active Approvals ============ */}
          <Section index={0} title="Active Approvals" subtitle={`${activeApprovals.length} approvals across ${new Set(activeApprovals.map(a => a.token)).size} tokens`}>
            {/* Filter + Batch Controls */}
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Filter:</span>
                {['all', 'high', 'medium', 'low'].map((level) => (
                  <button key={level} onClick={() => setFilterRisk(level)}
                    className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-1 rounded-full transition-colors"
                    style={{ background: filterRisk === level ? `${CYAN}15` : 'transparent',
                      border: `1px solid ${filterRisk === level ? `${CYAN}40` : 'rgba(255,255,255,0.08)'}`,
                      color: filterRisk === level ? CYAN : 'rgba(255,255,255,0.4)' }}>
                    {level}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={selectAll}
                  className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-1 rounded-full transition-colors"
                  style={{ background: 'transparent', border: `1px solid ${CYAN}30`, color: CYAN }}>
                  {selectedIds.size === filteredApprovals.length && filteredApprovals.length > 0 ? 'Deselect All' : 'Select All'}
                </button>
                <AnimatePresence>
                  {selectedIds.size > 0 && (
                    <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      onClick={batchRevoke} className="text-[10px] font-mono font-bold px-3 py-1.5 rounded-lg"
                      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                      Revoke Selected ({selectedIds.size})
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
            {/* Approval List */}
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {filteredApprovals.map((approval, i) => (
                  <ApprovalRow key={approval.id} approval={approval} index={i}
                    isSelected={selectedIds.has(approval.id)} onToggle={toggleSelect}
                    onRevoke={revokeOne} isRevoking={revokingIds.has(approval.id)} />
                ))}
              </AnimatePresence>
              {filteredApprovals.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-[11px] font-mono text-black-500">
                    {revokedIds.size > 0 ? 'All approvals in this category have been revoked.' : 'No approvals found.'}
                  </p>
                </div>
              )}
            </div>
          </Section>

          {/* ============ 2. Risk Breakdown ============ */}
          <Section index={1} title="Risk Breakdown" subtitle="Approval risk distribution by category">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(RISK_LEVELS).map(([key, risk], i) => {
                const count = activeApprovals.filter((a) => a.risk === key).length
                const pct = activeApprovals.length > 0 ? (count / activeApprovals.length) * 100 : 0
                return (
                  <motion.div key={key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * (0.08 * PHI), duration: 0.4, ease }}
                    className="rounded-xl p-4" style={{ background: `${risk.color}04`, border: `1px solid ${risk.border}` }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: risk.color, boxShadow: `0 0 8px ${risk.color}40` }} />
                        <span className="text-[11px] font-mono font-bold" style={{ color: risk.color }}>{risk.label} Risk</span>
                      </div>
                      <span className="text-lg font-mono font-bold text-white">{count}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'easeOut', delay: 0.5 + i * 0.15 }}
                        style={{ background: `linear-gradient(90deg, ${risk.color}80, ${risk.color})` }} />
                    </div>
                    <p className="text-[9px] font-mono text-black-500 mt-2">
                      {key === 'high' && 'Unlimited amounts or unverified spenders'}
                      {key === 'medium' && 'Large amounts (>$50,000) to trusted contracts'}
                      {key === 'low' && 'Small amounts to verified, audited contracts'}
                    </p>
                  </motion.div>
                )
              })}
            </div>
          </Section>

          {/* ============ 3. Total Value At Risk ============ */}
          <Section index={2} title="Total Value At Risk" subtitle="Estimated USD value exposed through active approvals">
            <div className="flex flex-col md:flex-row items-center gap-6">
              {/* Risk Ring */}
              <div className="flex-shrink-0 flex flex-col items-center justify-center">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                    <motion.circle cx="50" cy="50" r="42" fill="none" stroke="#ef4444" strokeWidth="6"
                      strokeLinecap="round" strokeDasharray={2 * Math.PI * 42}
                      initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - Math.min(highRiskCount / Math.max(activeApprovals.length, 1), 1)) }}
                      transition={{ duration: 1.5, ease: 'easeOut', delay: 0.3 }} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-mono text-black-500">at risk</span>
                    <span className="text-xl font-mono font-bold" style={{ color: '#ef4444' }}>
                      ${totalAtRisk >= 1000000 ? (totalAtRisk / 1000000).toFixed(1) + 'M' : Math.floor(totalAtRisk / 1000).toLocaleString() + 'K'}
                    </span>
                  </div>
                </div>
              </div>
              {/* Per-token breakdown */}
              <div className="flex-1 space-y-2 w-full">
                {Array.from(new Set(activeApprovals.map((a) => a.token))).map((token, i) => {
                  const tokenRisk = activeApprovals.filter((a) => a.token === token).reduce((s, a) => {
                    if (a.isUnlimited) return s + 100000 * TOKEN_PRICES[token]
                    return s + (a.usdValue || 0)
                  }, 0)
                  const pct = totalAtRisk > 0 ? (tokenRisk / totalAtRisk) * 100 : 0
                  return (
                    <motion.div key={token} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * (0.06 * PHI), duration: 0.4, ease }}
                      className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-black-400 w-12 text-right flex-shrink-0">{token}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'easeOut', delay: 0.4 + i * 0.1 }}
                          style={{ background: `linear-gradient(90deg, ${TOKEN_COLORS[token]}80, ${TOKEN_COLORS[token]})` }} />
                      </div>
                      <span className="text-[10px] font-mono font-bold w-16 text-right" style={{ color: TOKEN_COLORS[token] }}>
                        ${tokenRisk >= 1000 ? Math.floor(tokenRisk / 1000).toLocaleString() + 'K' : tokenRisk.toFixed(0)}
                      </span>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </Section>

          {/* ============ 4. Approval History Timeline ============ */}
          <Section index={3} title="Approval History" subtitle="Recent approval and revocation events">
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px" style={{ background: `linear-gradient(180deg, ${CYAN}40, transparent)` }} />
              <div className="space-y-3">
                {historyEvents.map((event, i) => (
                  <HistoryEvent key={event.id} event={event} index={i} />
                ))}
              </div>
            </div>
          </Section>

          {/* ============ 5. Best Practices ============ */}
          <Section index={4} title="Best Practices" subtitle="Protecting yourself from approval-based exploits">
            <div className="space-y-2.5">
              {BEST_PRACTICES.map((tip, i) => {
                const priorityColors = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6' }
                const pc = priorityColors[tip.priority]
                return (
                  <motion.div key={tip.title} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * (0.06 * PHI), duration: 0.4, ease }}
                    className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${pc}15` }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pc }} />
                      <h4 className="text-[11px] font-mono font-bold text-white">{tip.title}</h4>
                      <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full ml-auto"
                        style={{ background: `${pc}10`, border: `1px solid ${pc}25`, color: pc }}>{tip.priority}</span>
                    </div>
                    <p className="text-[10px] font-mono text-black-400 leading-relaxed">{tip.desc}</p>
                  </motion.div>
                )
              })}
            </div>
            <div className="mt-4 rounded-lg p-4" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}15` }}>
              <p className="text-[10px] font-mono text-black-400 leading-relaxed">
                <span className="text-white font-bold">Key insight:</span> Token approvals are the most common
                attack vector in DeFi. Over <span style={{ color: '#ef4444' }}>$2.7 billion</span> has been stolen
                through approval exploits since 2020. The contracts you trust today can be{' '}
                <span style={{ color: '#ef4444' }}>compromised tomorrow</span>. Minimize your exposure by approving
                exact amounts and revoking immediately after use. Your{' '}
                <span style={{ color: '#22c55e' }}>security is your responsibility</span>.
              </p>
            </div>
          </Section>
        </div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <blockquote className="max-w-md mx-auto">
            <p className="text-sm text-black-300 italic">"Not your keys, not your bitcoin. Not your revokes, not your safety."</p>
            <cite className="text-[10px] font-mono text-black-500 mt-1 block">— VibeSwap Security Principles</cite>
          </blockquote>
          <div className="w-16 h-px mx-auto my-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">Approval Hygiene</p>
        </motion.div>
      </div>
    </div>
  )
}
