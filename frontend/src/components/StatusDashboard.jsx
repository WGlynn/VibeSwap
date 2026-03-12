import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const POLL_INTERVAL = 30_000
const UPTIME_TICK_MS = 1_000

// ============ Mock Data ============
// Service definitions — will connect to real health endpoints post-launch
const SERVICES = [
  { id: 'swap',       name: 'Swap Engine',  desc: 'Commit-reveal batch auctions',     seed: 42 },
  { id: 'amm',        name: 'AMM',          desc: 'Constant product market maker',    seed: 137 },
  { id: 'oracle',     name: 'Oracle',       desc: 'Kalman filter price feeds',         seed: 256 },
  { id: 'bridge',     name: 'Bridge',       desc: 'LayerZero cross-chain messaging',   seed: 314 },
  { id: 'identity',   name: 'Identity',     desc: 'WebAuthn / passkey wallets',        seed: 404 },
  { id: 'treasury',   name: 'Treasury',     desc: 'DAO treasury management',           seed: 512 },
  { id: 'governance', name: 'Governance',   desc: 'On-chain voting & proposals',       seed: 618 },
  { id: 'api',        name: 'API',          desc: 'REST + WebSocket endpoints',        seed: 777 },
]

const STATUS_COLORS = {
  operational:  { dot: 'bg-green-500',  text: 'text-green-400', label: 'Operational' },
  degraded:     { dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'Degraded' },
  outage:       { dot: 'bg-red-500',    text: 'text-red-400',   label: 'Outage' },
  maintenance:  { dot: 'bg-blue-500',   text: 'text-blue-400',  label: 'Maintenance' },
}

const CHAINS = [
  { id: 'base',      name: 'Base',      chainId: 8453,   rpc: 'base-mainnet' },
  { id: 'ethereum',  name: 'Ethereum',  chainId: 1,      rpc: 'eth-mainnet' },
  { id: 'arbitrum',  name: 'Arbitrum',  chainId: 42161,  rpc: 'arb-mainnet' },
  { id: 'optimism',  name: 'Optimism',  chainId: 10,     rpc: 'op-mainnet' },
]

const INCIDENTS = [
  {
    id: 1,
    title: 'Oracle latency spike',
    status: 'resolved',
    date: '2026-03-10T14:22:00Z',
    duration: '12 min',
    resolution: 'Kalman filter recalibrated after price feed delay from upstream provider.',
  },
  {
    id: 2,
    title: 'Bridge queue congestion',
    status: 'resolved',
    date: '2026-03-08T09:15:00Z',
    duration: '28 min',
    resolution: 'LayerZero endpoint throttled during gas spike. Auto-scaled relayer capacity.',
  },
  {
    id: 3,
    title: 'API rate limit adjustment',
    status: 'resolved',
    date: '2026-03-05T18:40:00Z',
    duration: '5 min',
    resolution: 'Rate limits temporarily tightened during DDoS mitigation. Normal operations restored.',
  },
  {
    id: 4,
    title: 'Governance vote tallying delay',
    status: 'resolved',
    date: '2026-03-01T22:10:00Z',
    duration: '45 min',
    resolution: 'Snapshot sync lag caused delayed finalization. Root cause: stale subgraph index.',
  },
]

const STATUS_UPDATES = [
  { date: '2026-03-12', text: 'All systems nominal. Zero MEV extracted in last 24h.' },
  { date: '2026-03-11', text: 'Deployed circuit breaker v2.1 — tighter volume thresholds.' },
  { date: '2026-03-10', text: 'Oracle latency spike resolved. 99.97% uptime maintained.' },
  { date: '2026-03-09', text: 'Cross-chain batch settlement upgraded to sub-second finality.' },
  { date: '2026-03-08', text: 'Bridge congestion resolved. LayerZero relayer capacity doubled.' },
  { date: '2026-03-07', text: 'New Shapley distribution round completed — 142 LPs rewarded.' },
]

// ============ Helpers ============
function randomLatency(seed, base = 12) {
  // Deterministic "latency" from seed
  const r = ((seed * 16807) % 2147483647) / 2147483647
  return Math.round(base + r * 40)
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function generateServiceStatus(service) {
  // Deterministic status from seed — all operational for now
  return {
    ...service,
    status: 'operational',
    latency: randomLatency(service.seed),
    sparkData: generateSparklineData(service.seed, 20, 0.015),
  }
}

// ============ Sub-Components ============

function OverallStatusBanner({ services }) {
  const allOp = services.every(s => s.status === 'operational')
  const hasOutage = services.some(s => s.status === 'outage')
  const status = hasOutage ? 'outage' : allOp ? 'operational' : 'degraded'

  const config = {
    operational: {
      bg: 'from-green-500/10 to-green-500/5',
      border: 'border-green-500/20',
      dot: 'bg-green-500',
      text: 'text-green-400',
      label: 'All Systems Operational',
    },
    degraded: {
      bg: 'from-yellow-500/10 to-yellow-500/5',
      border: 'border-yellow-500/20',
      dot: 'bg-yellow-500',
      text: 'text-yellow-400',
      label: 'Partial System Degradation',
    },
    outage: {
      bg: 'from-red-500/10 to-red-500/5',
      border: 'border-red-500/20',
      dot: 'bg-red-500',
      text: 'text-red-400',
      label: 'System Outage Detected',
    },
  }

  const c = config[status]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
      className={`relative overflow-hidden rounded-2xl border ${c.border} bg-gradient-to-r ${c.bg} p-5 mb-6`}
    >
      <div className="flex items-center justify-center gap-3">
        <span className={`w-3 h-3 rounded-full ${c.dot} animate-pulse`} />
        <span className={`text-lg font-mono font-bold ${c.text}`}>
          {c.label}
        </span>
      </div>
      <p className="text-center text-xs text-black-500 font-mono mt-1">
        Last checked: {new Date().toLocaleTimeString()}
      </p>
    </motion.div>
  )
}

function ServiceStatusGrid({ services }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono text-black-400 uppercase tracking-wider mb-4 px-1">
        Service Status
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {services.map((svc, i) => {
          const sc = STATUS_COLORS[svc.status]
          return (
            <motion.div
              key={svc.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 1 / (PHI * PHI) }}
            >
              <GlassCard glowColor="terminal" className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${sc.dot} shrink-0`} />
                    <span className="text-sm font-mono font-medium text-white">{svc.name}</span>
                  </div>
                  <span className={`text-[10px] font-mono ${sc.text}`}>{sc.label}</span>
                </div>
                <p className="text-[10px] font-mono text-black-500 mb-3">{svc.desc}</p>
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-black-600">Latency</span>
                    <p className="text-sm font-mono font-bold" style={{ color: CYAN }}>{svc.latency}ms</p>
                  </div>
                  <Sparkline
                    data={svc.sparkData}
                    width={56}
                    height={18}
                    color={CYAN}
                    strokeWidth={1.5}
                  />
                </div>
              </GlassCard>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function IncidentHistory() {
  const [expanded, setExpanded] = useState(null)

  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono text-black-400 uppercase tracking-wider mb-4 px-1">
        Incident History
      </h2>
      <GlassCard glowColor="terminal" className="divide-y divide-black-800">
        {INCIDENTS.map((incident, i) => {
          const isOpen = expanded === incident.id
          const statusColor = incident.status === 'resolved' ? 'text-green-400' : 'text-yellow-400'
          const dotColor = incident.status === 'resolved' ? 'bg-green-500' : 'bg-yellow-500'

          return (
            <motion.div
              key={incident.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => setExpanded(isOpen ? null : incident.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className={`w-2 h-2 rounded-full ${dotColor} mt-1.5 shrink-0`} />
                  <div>
                    <p className="text-sm font-mono text-white">{incident.title}</p>
                    <p className="text-[10px] font-mono text-black-500 mt-0.5">
                      {formatDate(incident.date)} &middot; Duration: {incident.duration}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono capitalize ${statusColor}`}>
                    {incident.status}
                  </span>
                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    className="text-black-500 text-xs"
                  >
                    &#9660;
                  </motion.span>
                </div>
              </div>
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <p className="text-xs font-mono text-black-400 mt-3 ml-5 pl-3 border-l border-black-700">
                      {incident.resolution}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </GlassCard>
    </div>
  )
}

function PerformanceMetrics() {
  const metrics = [
    { label: 'Throughput (TPS)',   value: 847,   suffix: '',   seed: 1001, change: 3.2 },
    { label: 'p95 Latency',       value: 42,    suffix: 'ms', seed: 1002, change: -1.8 },
    { label: 'Error Rate',        value: 0.02,  suffix: '%',  seed: 1003, change: -0.5 },
  ]

  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono text-black-400 uppercase tracking-wider mb-4 px-1">
        Performance Metrics
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {metrics.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 1 / (PHI * PHI) }}
          >
            <GlassCard glowColor="terminal" className="p-4">
              <p className="text-[10px] font-mono text-black-500 uppercase mb-2">{m.label}</p>
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-2xl font-mono font-bold text-white">
                    {m.value}{m.suffix}
                  </span>
                  <div className={`text-[10px] font-mono mt-0.5 ${m.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {m.change >= 0 ? '+' : ''}{m.change}%
                  </div>
                </div>
                <Sparkline
                  data={generateSparklineData(m.seed, 24, 0.02)}
                  width={56}
                  height={20}
                  color={m.change >= 0 ? '#22c55e' : CYAN}
                />
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function ChainStatusRow() {
  // Simulated block heights and sync status
  const chainData = CHAINS.map((chain, i) => ({
    ...chain,
    blockHeight: 18_420_000 + i * 3_200_000 + Math.floor(Math.random() * 100),
    synced: true,
    latency: 8 + i * 5 + Math.floor(Math.random() * 10),
  }))

  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono text-black-400 uppercase tracking-wider mb-4 px-1">
        Chain Status
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {chainData.map((chain, i) => (
          <motion.div
            key={chain.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 1 / (PHI * PHI) }}
          >
            <GlassCard glowColor="terminal" className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${chain.synced ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-sm font-mono font-medium text-white">{chain.name}</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-black-500">Block</span>
                  <span className="text-[10px] font-mono text-black-300">
                    #{chain.blockHeight.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-black-500">Sync</span>
                  <span className={`text-[10px] font-mono ${chain.synced ? 'text-green-400' : 'text-yellow-400'}`}>
                    {chain.synced ? 'Synced' : 'Syncing...'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-black-500">Latency</span>
                  <span className="text-[10px] font-mono" style={{ color: CYAN }}>{chain.latency}ms</span>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function ContractHealth() {
  const contracts = [
    { name: 'VibeSwapCore',         lastDeploy: '2026-03-10', verified: true, auditScore: 98 },
    { name: 'CommitRevealAuction',   lastDeploy: '2026-03-10', verified: true, auditScore: 97 },
    { name: 'VibeAMM',              lastDeploy: '2026-03-08', verified: true, auditScore: 96 },
    { name: 'CrossChainRouter',      lastDeploy: '2026-03-06', verified: true, auditScore: 95 },
  ]

  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono text-black-400 uppercase tracking-wider mb-4 px-1">
        Contract Health
      </h2>
      <GlassCard glowColor="terminal" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-black-800">
                <th className="text-[10px] font-mono text-black-500 uppercase py-3 px-4">Contract</th>
                <th className="text-[10px] font-mono text-black-500 uppercase py-3 px-4">Last Deploy</th>
                <th className="text-[10px] font-mono text-black-500 uppercase py-3 px-4">Verified</th>
                <th className="text-[10px] font-mono text-black-500 uppercase py-3 px-4">Audit Score</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c, i) => (
                <motion.tr
                  key={c.name}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-black-800/50 last:border-b-0"
                >
                  <td className="text-sm font-mono text-white py-3 px-4">{c.name}</td>
                  <td className="text-xs font-mono text-black-400 py-3 px-4">{c.lastDeploy}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-mono ${c.verified ? 'text-green-400' : 'text-red-400'}`}>
                      {c.verified ? 'Verified' : 'Unverified'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-black-800 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${c.auditScore}%` }}
                          transition={{ delay: 0.3 + i * 0.1, duration: 0.6, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: c.auditScore >= 95 ? '#22c55e' : c.auditScore >= 80 ? '#eab308' : '#ef4444' }}
                        />
                      </div>
                      <span className="text-xs font-mono text-white">{c.auditScore}%</span>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}

function StatusFeed() {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-sm font-mono text-black-400 uppercase tracking-wider">
          Status Updates
        </h2>
        <span className="text-[10px] font-mono text-black-600 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
          RSS
        </span>
      </div>
      <GlassCard glowColor="terminal" className="divide-y divide-black-800">
        {STATUS_UPDATES.map((update, i) => (
          <motion.div
            key={update.date}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="p-4 flex gap-4"
          >
            <span className="text-[10px] font-mono text-black-600 whitespace-nowrap pt-0.5 shrink-0">
              {update.date}
            </span>
            <p className="text-xs font-mono text-black-300 leading-relaxed">{update.text}</p>
          </motion.div>
        ))}
      </GlassCard>
    </div>
  )
}

function AnimatedUptimeCounter({ target = 99.97 }) {
  const [displayed, setDisplayed] = useState(0)
  const frameRef = useRef(null)

  useEffect(() => {
    const start = performance.now()
    const duration = 2000

    function tick(now) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(eased * target)
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [target])

  return (
    <div className="text-center mb-8">
      <GlassCard glowColor="terminal" className="p-6 inline-block">
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
          Platform Uptime (30d)
        </p>
        <div className="flex items-baseline justify-center gap-1">
          <motion.span
            className="text-5xl font-mono font-bold"
            style={{ color: CYAN }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            {displayed.toFixed(2)}
          </motion.span>
          <span className="text-2xl font-mono font-bold text-black-400">%</span>
        </div>
        <div className="mt-3 flex justify-center gap-6">
          <div>
            <p className="text-[10px] font-mono text-black-600">Downtime</p>
            <p className="text-xs font-mono text-black-400">~13 min</p>
          </div>
          <div>
            <p className="text-[10px] font-mono text-black-600">Incidents</p>
            <p className="text-xs font-mono text-black-400">{INCIDENTS.length} resolved</p>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

function SubscribeAlerts() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)

  const handleSubscribe = (e) => {
    e.preventDefault()
    if (email.includes('@')) {
      setSubscribed(true)
      setEmail('')
    }
  }

  return (
    <div className="mb-8">
      <GlassCard glowColor="terminal" className="p-6">
        <div className="text-center">
          <h3 className="text-sm font-mono font-bold text-white mb-1">Subscribe to Status Alerts</h3>
          <p className="text-[10px] font-mono text-black-500 mb-4">
            Get notified when services are degraded or down
          </p>
          <AnimatePresence mode="wait">
            {subscribed ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center justify-center gap-2 py-2"
              >
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-mono text-green-400">Subscribed. You will be notified.</span>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                onSubmit={handleSubscribe}
                className="flex gap-2 max-w-sm mx-auto"
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 px-3 py-2 rounded-lg bg-black-800/80 border border-black-700 text-sm font-mono text-white placeholder-black-600 focus:outline-none focus:border-cyan-500/40 transition-colors"
                />
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="px-4 py-2 rounded-lg text-sm font-mono font-bold transition-colors"
                  style={{ backgroundColor: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}30` }}
                >
                  Subscribe
                </motion.button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Main Component ============
export default function StatusDashboard() {
  const [services, setServices] = useState(() =>
    SERVICES.map(generateServiceStatus)
  )
  const [now, setNow] = useState(Date.now())

  // Refresh service statuses periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setServices(SERVICES.map(generateServiceStatus))
    }, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  // Tick the clock for "last checked" freshness
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), UPTIME_TICK_MS)
    return () => clearInterval(tick)
  }, [])

  // Stagger container animation
  const stagger = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 1 / (PHI * PHI * PHI * 10) },
    },
  }

  return (
    <motion.div
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12"
      variants={stagger}
      initial="hidden"
      animate="show"
    >
      {/* ============ Hero ============ */}
      <PageHero
        title="System Status"
        subtitle="Real-time health monitoring for all VibeSwap services and infrastructure"
        category="system"
        badge="Live"
        badgeColor={CYAN}
      />

      {/* ============ Overall Status Banner ============ */}
      <OverallStatusBanner services={services} />

      {/* ============ Animated Uptime Counter ============ */}
      <AnimatedUptimeCounter target={99.97} />

      {/* ============ Key Stats Row ============ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard
          label="Uptime (30d)"
          value={99.97}
          suffix="%"
          decimals={2}
          sparkSeed={2001}
          size="sm"
        />
        <StatCard
          label="Avg Block Time"
          value={2.04}
          suffix="s"
          decimals={2}
          change={-0.3}
          sparkSeed={2002}
          size="sm"
        />
        <StatCard
          label="Gas Price"
          value={0.42}
          suffix=" gwei"
          decimals={2}
          change={-5.1}
          sparkSeed={2003}
          size="sm"
        />
        <StatCard
          label="Active Users"
          value={1247}
          decimals={0}
          change={12.4}
          sparkSeed={2004}
          size="sm"
        />
      </div>

      {/* ============ Service Status Grid ============ */}
      <ServiceStatusGrid services={services} />

      {/* ============ Performance Metrics ============ */}
      <PerformanceMetrics />

      {/* ============ Chain Status ============ */}
      <ChainStatusRow />

      {/* ============ Contract Health ============ */}
      <ContractHealth />

      {/* ============ Incident History ============ */}
      <IncidentHistory />

      {/* ============ Status Updates (RSS Feed) ============ */}
      <StatusFeed />

      {/* ============ Subscribe to Alerts ============ */}
      <SubscribeAlerts />

      {/* ============ Footer ============ */}
      <div className="text-center mt-4">
        <p className="text-[10px] font-mono text-black-600">
          Status data refreshes every 30 seconds. All times in local timezone.
        </p>
        <p className="text-[10px] font-mono text-black-700 mt-1">
          VibeSwap &middot; Cooperative Capitalism &middot; MEV-Free by Design
        </p>
      </div>
    </motion.div>
  )
}
