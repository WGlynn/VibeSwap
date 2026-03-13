import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

const HEALTH_THRESHOLDS = [
  { min: 90, label: 'Excellent', color: '#22c55e' },
  { min: 75, label: 'Good', color: '#06b6d4' },
  { min: 50, label: 'Fair', color: '#f59e0b' },
  { min: 0,  label: 'Critical', color: '#ef4444' },
]
function getHealthInfo(score) { return HEALTH_THRESHOLDS.find(t => score >= t.min) || HEALTH_THRESHOLDS[3] }

// ============ Mock Data ============

const SAFETY_SYSTEMS = [
  { id: 'circuit-breaker', name: 'Circuit Breaker', icon: '\u26A1', statusLabel: 'Active', statusColor: '#22c55e',
    description: 'Automatic trading halt when anomalies detected',
    metrics: [
      { label: 'Volume Threshold', value: '$10M/hr', status: 'ok' },
      { label: 'Price Deviation Max', value: '5.0%', status: 'ok' },
      { label: 'Withdrawal Limit', value: '$2M/hr', status: 'ok' },
      { label: 'Last Triggered', value: '18h ago', status: 'info' },
    ] },
  { id: 'twap-oracle', name: 'TWAP Oracle', icon: '\u25C9', statusLabel: 'Healthy', statusColor: '#22c55e',
    description: 'Time-weighted average price with Kalman filter validation',
    metrics: [
      { label: 'Current Deviation', value: '0.12%', status: 'ok' },
      { label: 'Max Allowed', value: '5.0%', status: 'ok' },
      { label: 'Last Update', value: '2s ago', status: 'ok' },
      { label: 'Feed Sources', value: '3 active', status: 'ok' },
    ] },
  { id: 'rate-limiter', name: 'Rate Limiter', icon: '\u29D7', statusLabel: 'Normal', statusColor: '#22c55e',
    description: 'Per-address and global throughput limits',
    metrics: [
      { label: 'Global Usage', value: '23.4%', status: 'ok' },
      { label: 'Per-User Limit', value: '1M tokens/hr', status: 'ok' },
      { label: 'Pool Rate Cap', value: '10% TVL/hr', status: 'ok' },
      { label: 'Cooldown Active', value: '0 users', status: 'ok' },
    ] },
  { id: 'commit-reveal', name: 'Commit-Reveal', icon: '\u29C9', statusLabel: 'Operating', statusColor: '#22c55e',
    description: 'Batch auction integrity with MEV protection',
    metrics: [
      { label: 'Batch Success Rate', value: '99.7%', status: 'ok' },
      { label: 'Invalid Reveals', value: '0.3%', status: 'warn' },
      { label: 'Slash Pool', value: '12.4 ETH', status: 'info' },
      { label: 'Avg Batch Size', value: '47 orders', status: 'ok' },
    ] },
]

const RESERVE_POOLS = [
  { pair: 'ETH / USDC',  ratio: 152.3, tvl: '$24.8M', utilization: 67.2, color: '#3b82f6' },
  { pair: 'WBTC / ETH',  ratio: 148.7, tvl: '$18.2M', utilization: 54.1, color: '#f59e0b' },
  { pair: 'USDC / USDT', ratio: 201.4, tvl: '$31.5M', utilization: 42.8, color: '#22c55e' },
  { pair: 'ETH / DAI',   ratio: 138.9, tvl: '$8.7M',  utilization: 71.6, color: '#a855f7' },
  { pair: 'LINK / ETH',  ratio: 167.2, tvl: '$5.1M',  utilization: 38.4, color: '#06b6d4' },
  { pair: 'ARB / USDC',  ratio: 124.5, tvl: '$3.9M',  utilization: 82.3, color: '#ef4444' },
]

const NETWORK_STATS = [
  { label: 'Block Time',   value: '12.1s',   trend: 'stable', icon: '\u25A3' },
  { label: 'Finality',     value: '~13 min',  trend: 'stable', icon: '\u2713' },
  { label: 'Gas (Avg)',    value: '24 gwei',  trend: 'down',   icon: '\u2B21' },
  { label: 'Gas (Fast)',   value: '31 gwei',  trend: 'down',   icon: '\u26A1' },
  { label: 'Pending Txs',  value: '1,247',    trend: 'up',     icon: '\u29D7' },
  { label: 'Mempool Size', value: '3.2 MB',   trend: 'stable', icon: '\u25A6' },
]

const INCIDENTS = [
  { id: 1, date: '2026-02-28', title: 'Withdrawal Breaker Triggered \u2014 Whale Cluster Exit',
    type: 'Circuit Breaker', severity: 'medium', severityColor: '#f59e0b', resolutionTime: '12 min',
    postmortem: '/docs/incidents/2026-02-28-withdrawal',
    description: 'Coordinated withdrawal of $1.8M from three related addresses triggered the withdrawal circuit breaker. System auto-paused withdrawals, allowing orderly queue processing.' },
  { id: 2, date: '2026-02-14', title: 'Oracle Feed Stale \u2014 Chainlink Heartbeat Miss',
    type: 'Oracle', severity: 'low', severityColor: '#06b6d4', resolutionTime: '8 min',
    postmortem: '/docs/incidents/2026-02-14-oracle',
    description: 'Chainlink ETH/USD feed missed a heartbeat during L1 congestion. Kalman filter automatically increased weight on Pyth and on-chain TWAP. No trades were affected.' },
  { id: 3, date: '2026-01-22', title: 'Price Breaker Trip \u2014 Flash Crash on ETH/USDC',
    type: 'Circuit Breaker', severity: 'high', severityColor: '#ef4444', resolutionTime: '22 min',
    postmortem: '/docs/incidents/2026-01-22-price',
    description: 'External CEX flash crash caused 7.2% price deviation. Circuit breaker halted trading within 200ms. Post-recovery analysis confirmed no user funds were at risk.' },
  { id: 4, date: '2025-12-31', title: 'Rate Limiter \u2014 Sybil Attempt Detected',
    type: 'Rate Limiter', severity: 'medium', severityColor: '#f59e0b', resolutionTime: '3 min',
    postmortem: '/docs/incidents/2025-12-31-ratelimit',
    description: '42 addresses identified as potential Sybil cluster attempting to exceed rate limits. Graduated limit system kept all addresses at 10% max allocation. No impact on legitimate users.' },
  { id: 5, date: '2025-12-18', title: 'Cross-Chain Delay \u2014 Arbitrum Sequencer Pause',
    type: 'Bridge', severity: 'low', severityColor: '#06b6d4', resolutionTime: '45 min',
    postmortem: '/docs/incidents/2025-12-18-bridge',
    description: 'Arbitrum sequencer experienced a brief outage causing LayerZero message delays. Bridge breaker activated, queuing 23 pending transfers. All completed after sequencer resumed.' },
]

const AUDITS = [
  { id: 1, firm: 'Trail of Bits', logo: '\u2726', date: '2026-01-15',
    scope: 'Core contracts (CommitRevealAuction, VibeSwapCore, VibeAMM)',
    findings: { critical: 0, high: 0, medium: 2, low: 5, informational: 8 },
    status: 'completed', statusColor: '#22c55e', reportUrl: '/docs/audits/trail-of-bits-2026' },
  { id: 2, firm: 'OpenZeppelin', logo: '\u2B21', date: '2026-02-20',
    scope: 'Cross-chain messaging (CrossChainRouter, LayerZero integration)',
    findings: { critical: 0, high: 1, medium: 3, low: 4, informational: 6 },
    status: 'completed', statusColor: '#22c55e', reportUrl: '/docs/audits/openzeppelin-2026' },
  { id: 3, firm: 'Spearbit', logo: '\u25C8', date: '2026-03-10',
    scope: 'Economic security (ShapleyDistributor, ILProtection, TreasuryStabilizer)',
    findings: { critical: 0, high: 0, medium: 1, low: 2, informational: 3 },
    status: 'in-progress', statusColor: '#f59e0b', reportUrl: null },
]

// ============ Subcomponents ============

function HealthGauge({ score, size = 200 }) {
  const health = getHealthInfo(score)
  const r = (size - 20) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.05)" strokeWidth="8" fill="none" />
        <motion.circle cx={size/2} cy={size/2} r={r} stroke={health.color} strokeWidth="8" fill="none"
          strokeLinecap="round" strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: [0.25, 0.1, 1/PHI, 1] }} />
        <motion.circle cx={size/2} cy={size/2} r={r} stroke={health.color} strokeWidth="12" fill="none"
          strokeLinecap="round" strokeDasharray={circ} opacity={0.15}
          initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: [0.25, 0.1, 1/PHI, 1] }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span className="text-4xl font-bold font-mono" style={{ color: health.color }}
          initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}>{score}</motion.span>
        <motion.span className="text-xs font-mono uppercase tracking-wider mt-1"
          style={{ color: health.color, opacity: 0.8 }}
          initial={{ opacity: 0 }} animate={{ opacity: 0.8 }}
          transition={{ duration: 0.6, delay: 0.8 }}>{health.label}</motion.span>
      </div>
    </div>
  )
}

function StatusBadge({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />
      <span className="text-xs font-mono" style={{ color }}>{label}</span>
    </div>
  )
}

function HealthBar({ value, max = 250, color }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
      <motion.div className="h-full rounded-full" style={{ backgroundColor: color }}
        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
        transition={{ duration: 1.0, ease: [0.25, 0.1, 1/PHI, 1] }} />
    </div>
  )
}

function SeverityBadge({ severity, color }) {
  const bg = { low: 'bg-cyan-500/10 border-cyan-500/20', medium: 'bg-amber-500/10 border-amber-500/20',
    high: 'bg-red-500/10 border-red-500/20', critical: 'bg-red-600/20 border-red-500/30' }
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${bg[severity] || bg.low}`}
      style={{ color }}>{severity}</span>
  )
}

function TrendIndicator({ trend }) {
  const cfg = { up: { s: '\u2191', c: '#f59e0b' }, down: { s: '\u2193', c: '#22c55e' }, stable: { s: '\u2192', c: '#6b7280' } }
  const t = cfg[trend] || cfg.stable
  return <span className="text-xs font-mono" style={{ color: t.c }}>{t.s}</span>
}

function FindingsSummary({ findings }) {
  const items = [
    { k: 'critical', l: 'C', c: '#ef4444' }, { k: 'high', l: 'H', c: '#f97316' },
    { k: 'medium', l: 'M', c: '#f59e0b' }, { k: 'low', l: 'L', c: '#06b6d4' },
    { k: 'informational', l: 'I', c: '#6b7280' },
  ]
  return (
    <div className="flex items-center gap-2">
      {items.map(({ k, l, c }) => (
        <div key={k} className="flex items-center gap-1">
          <span className="text-[10px] font-mono" style={{ color: c, opacity: 0.7 }}>{l}:</span>
          <span className="text-xs font-mono font-bold"
            style={{ color: findings[k] > 0 ? c : 'rgba(255,255,255,0.2)' }}>{findings[k]}</span>
        </div>
      ))}
    </div>
  )
}

// ============ Main Component ============

export default function ProtocolHealthPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [healthScore, setHealthScore] = useState(0)
  const [expandedIncident, setExpandedIncident] = useState(null)
  const [selectedSystemTab, setSelectedSystemTab] = useState('circuit-breaker')
  const [uptimeSeconds, setUptimeSeconds] = useState(0)

  useEffect(() => { const t = setTimeout(() => setHealthScore(94), 300); return () => clearTimeout(t) }, [])
  useEffect(() => { const iv = setInterval(() => setUptimeSeconds(p => p + 1), 1000); return () => clearInterval(iv) }, [])

  const sparklineData = useMemo(() => {
    const rng = seededRandom(42)
    return Array.from({ length: 24 }, (_, i) => ({ hour: i, score: 88 + Math.floor(rng() * 12) }))
  }, [])

  const selectedSystem = SAFETY_SYSTEMS.find(s => s.id === selectedSystemTab)

  const formatUptime = (s) => {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60), sec = s % 60
    return `${d}d ${h}h ${m}m ${String(sec).padStart(2, '0')}s`
  }

  const totalFindings = AUDITS.reduce((acc, a) => ({
    critical: acc.critical + a.findings.critical, high: acc.high + a.findings.high,
    medium: acc.medium + a.findings.medium, low: acc.low + a.findings.low,
    informational: acc.informational + a.findings.informational,
  }), { critical: 0, high: 0, medium: 0, low: 0, informational: 0 })

  return (
    <div className="min-h-screen pb-20">
      <PageHero
        title="Protocol Health"
        subtitle="Real-time monitoring of VibeSwap's safety systems, reserves, and risk metrics"
        category="protocol"
        badge="Live"
        badgeColor="#22c55e"
      />

      <div className="max-w-7xl mx-auto px-4 space-y-8">

        {/* ============ Overall Health Score ============ */}
        <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible">
          <GlassCard className="p-6" glowColor="terminal">
            <div className="flex flex-col lg:flex-row items-center gap-8">
              <div className="flex-shrink-0">
                <HealthGauge score={healthScore} size={200} />
              </div>
              <div className="flex-1 w-full">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold">Overall Protocol Health</h2>
                    <p className="text-xs text-neutral-400 mt-1">
                      Composite score from safety systems, reserve ratios, oracle health, and network conditions
                    </p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="text-[10px] font-mono text-neutral-500">UPTIME</div>
                    <div className="text-sm font-mono text-green-400">{formatUptime(uptimeSeconds + 2847293)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Safety Systems', score: 97, color: '#22c55e' },
                    { label: 'Reserves', score: 92, color: '#3b82f6' },
                    { label: 'Oracle Health', score: 96, color: '#a855f7' },
                    { label: 'Network', score: 91, color: '#06b6d4' },
                  ].map((item) => (
                    <div key={item.label} className="text-center">
                      <div className="text-2xl font-bold font-mono" style={{ color: item.color }}>{item.score}</div>
                      <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider mt-1">{item.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-white/5">
                  <div className="text-[10px] font-mono text-neutral-500 mb-2">24H HEALTH TREND</div>
                  <div className="flex items-end gap-[3px] h-8">
                    {sparklineData.map((d, i) => {
                      const info = getHealthInfo(d.score)
                      return (
                        <motion.div key={i} className="flex-1 rounded-t-sm min-w-[4px]"
                          style={{ backgroundColor: info.color, opacity: 0.7 }}
                          initial={{ height: 0 }} animate={{ height: `${((d.score - 85) / 15) * 100}%` }}
                          transition={{ duration: 0.5, delay: i * 0.02 }} />
                      )
                    })}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-neutral-600 font-mono">24h ago</span>
                    <span className="text-[9px] text-neutral-600 font-mono">now</span>
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Safety Systems ============ */}
        <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span style={{ color: CYAN }}>&#x25C8;</span> Safety Systems
          </h2>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            {SAFETY_SYSTEMS.map((sys) => (
              <button key={sys.id} onClick={() => setSelectedSystemTab(sys.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-mono whitespace-nowrap transition-all ${
                  selectedSystemTab === sys.id
                    ? 'bg-white/10 border border-white/20 text-white'
                    : 'bg-white/[0.03] border border-white/5 text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.06]'
                }`}>
                <span>{sys.icon}</span><span>{sys.name}</span>
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sys.statusColor }} />
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            {selectedSystem && (
              <motion.div key={selectedSystem.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                <GlassCard className="p-6" glowColor="matrix">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{selectedSystem.icon}</span>
                        <h3 className="text-lg font-bold">{selectedSystem.name}</h3>
                        <StatusBadge color={selectedSystem.statusColor} label={selectedSystem.statusLabel} />
                      </div>
                      <p className="text-sm text-neutral-400 mt-1">{selectedSystem.description}</p>
                    </div>
                    <Link to={selectedSystem.id === 'circuit-breaker' ? '/circuit-breaker' : '/security'}
                      className="text-xs font-mono px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-neutral-300 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap">
                      View Details &#x2192;
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {selectedSystem.metrics.map((m, i) => {
                      const sc = m.status === 'ok' ? '#22c55e' : m.status === 'warn' ? '#f59e0b' : '#6b7280'
                      return (
                        <div key={i} className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                          <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider mb-2">{m.label}</div>
                          <div className="flex items-center justify-between">
                            <span className="text-lg font-bold font-mono">{m.value}</span>
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sc }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ============ Reserve Ratios ============ */}
        <motion.div custom={2} variants={sectionV} initial="hidden" animate="visible">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span style={{ color: CYAN }}>&#x25A3;</span> Reserve Ratios
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {RESERVE_POOLS.map((pool) => {
              const hc = pool.ratio >= 150 ? '#22c55e' : pool.ratio >= 120 ? '#06b6d4' : pool.ratio >= 100 ? '#f59e0b' : '#ef4444'
              const hl = pool.ratio >= 150 ? 'Healthy' : pool.ratio >= 120 ? 'Good' : pool.ratio >= 100 ? 'Watch' : 'At Risk'
              return (
                <GlassCard key={pool.pair} className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: pool.color }} />
                      <span className="font-bold font-mono text-sm">{pool.pair}</span>
                    </div>
                    <StatusBadge color={hc} label={hl} />
                  </div>
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-2xl font-bold font-mono" style={{ color: hc }}>{pool.ratio.toFixed(1)}%</span>
                    <span className="text-xs text-neutral-500">collateralization</span>
                  </div>
                  <HealthBar value={pool.ratio} color={hc} />
                  <div className="flex justify-between mt-3 pt-3 border-t border-white/5">
                    <div>
                      <div className="text-[10px] font-mono text-neutral-500">TVL</div>
                      <div className="text-sm font-mono">{pool.tvl}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-mono text-neutral-500">UTILIZATION</div>
                      <div className="text-sm font-mono" style={{
                        color: pool.utilization > 75 ? '#f59e0b' : pool.utilization > 50 ? '#06b6d4' : '#22c55e'
                      }}>{pool.utilization.toFixed(1)}%</div>
                    </div>
                  </div>
                </GlassCard>
              )
            })}
          </div>
        </motion.div>

        {/* ============ Network Stats ============ */}
        <motion.div custom={3} variants={sectionV} initial="hidden" animate="visible">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span style={{ color: CYAN }}>&#x2B21;</span> Network Stats
          </h2>
          <GlassCard className="p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {NETWORK_STATS.map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-lg mb-2 opacity-40">{stat.icon}</div>
                  <div className="text-lg font-bold font-mono">{stat.value}</div>
                  <div className="flex items-center justify-center gap-1.5 mt-1">
                    <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">{stat.label}</span>
                    <TrendIndicator trend={stat.trend} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-4 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-sm text-neutral-300">All systems operational</span>
                </div>
                <span className="text-xs font-mono text-neutral-500">
                  Last checked: {Math.max(0, uptimeSeconds % 30)}s ago
                </span>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Incident History ============ */}
        <motion.div custom={4} variants={sectionV} initial="hidden" animate="visible">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span style={{ color: CYAN }}>&#x25C6;</span> Incident History
          </h2>
          <div className="space-y-3">
            {INCIDENTS.map((inc) => (
              <GlassCard key={inc.id} className="p-0">
                <button onClick={() => setExpandedIncident(expandedIncident === inc.id ? null : inc.id)}
                  className="w-full p-4 sm:p-5 text-left">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="text-xs font-mono text-neutral-500 sm:w-24 flex-shrink-0">{inc.date}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{inc.title}</span>
                        <SeverityBadge severity={inc.severity} color={inc.severityColor} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] font-mono text-neutral-500">RESOLVED IN</div>
                        <div className="text-sm font-mono text-green-400">{inc.resolutionTime}</div>
                      </div>
                      <motion.span className="text-neutral-500 text-xs"
                        animate={{ rotate: expandedIncident === inc.id ? 180 : 0 }}>&#x25BC;</motion.span>
                    </div>
                  </div>
                </button>
                <AnimatePresence>
                  {expandedIncident === inc.id && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                      <div className="px-5 pb-5 pt-0">
                        <div className="border-t border-white/5 pt-4">
                          <p className="text-sm text-neutral-400 leading-relaxed mb-3">{inc.description}</p>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="text-neutral-500">Type: <span className="font-mono text-neutral-300">{inc.type}</span></span>
                            <span className="text-neutral-500">Status: <span className="font-mono text-green-400">resolved</span></span>
                            <Link to={inc.postmortem} className="font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                              onClick={(e) => e.stopPropagation()}>Read Postmortem &#x2192;</Link>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            ))}
          </div>
        </motion.div>

        {/* ============ Audit Status ============ */}
        <motion.div custom={5} variants={sectionV} initial="hidden" animate="visible">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span style={{ color: CYAN }}>&#x2726;</span> Audit Status
          </h2>
          <GlassCard className="p-4 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Aggregate Findings Across All Audits</h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {AUDITS.length} audits ({AUDITS.filter(a => a.status === 'completed').length} completed, {AUDITS.filter(a => a.status === 'in-progress').length} in progress)
                </p>
              </div>
              <FindingsSummary findings={totalFindings} />
            </div>
          </GlassCard>
          <div className="space-y-3">
            {AUDITS.map((audit) => (
              <GlassCard key={audit.id} className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex items-center gap-3 sm:w-48 flex-shrink-0">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg">
                      {audit.logo}
                    </div>
                    <div>
                      <div className="font-bold text-sm">{audit.firm}</div>
                      <div className="text-xs font-mono text-neutral-500">{audit.date}</div>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-neutral-300 mb-3">{audit.scope}</p>
                    <FindingsSummary findings={audit.findings} />
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <StatusBadge color={audit.statusColor}
                      label={audit.status === 'completed' ? 'Completed' : 'In Progress'} />
                    {audit.reportUrl && (
                      <Link to={audit.reportUrl}
                        className="text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors">
                        Report &#x2192;
                      </Link>
                    )}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div custom={6} variants={sectionV} initial="hidden" animate="visible">
          <div className="text-center py-6 border-t border-white/5">
            <p className="text-xs text-neutral-500 font-mono">
              Protocol health data refreshes every 30 seconds. All safety systems are autonomous and permissionless.
            </p>
            <p className="text-[10px] text-neutral-600 font-mono mt-1">
              VibeSwap Protocol v1.0 &#x2014; Cooperative Capitalism
            </p>
          </div>
        </motion.div>

      </div>
    </div>
  )
}
